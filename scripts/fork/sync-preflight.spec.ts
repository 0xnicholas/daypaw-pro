/**
 * Behavior of the sync preflight: bundle-row parsing, the fork-owned
 * boundary, roster deltas, and one scratch-repository run that pins the
 * report's conflict, deletion, and rename fields end to end.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  classifyConflict,
  computeRosterDelta,
  entryPaths,
  expandBraces,
  isForkOwnedPath,
  packageRootOf,
  parseBundleRows,
  parseCheckpointUpstreamSha,
  parseCoreTouches,
  parseNameStatus,
  registryEntriesFor,
  renderSyncPreflight,
  stripQualifier,
  type PreflightReport,
} from './sync-preflight.ts'

const UPSTREAM_PATCH = 'packages/bundle/web-app/cordis.patch.yml'
const FORK_PATCH = 'packages/daypaw/web-app/cordis.patch.yml'

describe('parseCheckpointUpstreamSha', () => {
  it('reads the sha a checkpoint tag records', () => {
    expect(parseCheckpointUpstreamSha('upstream: deepseek-ai/deepseek-harness@c291e7961a'))
      .toBe('c291e7961a')
  })

  it('returns undefined when the message carries no sha', () => {
    expect(parseCheckpointUpstreamSha('upstream: deepseek-ai/deepseek-harness')).toBeUndefined()
  })
})

describe('isForkOwnedPath', () => {
  it.each([
    'packages/daypaw/engine/src/index.ts',
    'apps/daypaw-web/vite.config.ts',
    'docs/adr/0016-spawn.md',
    'CONTEXT.md',
  ])('claims %s for the fork', (path) => {
    expect(isForkOwnedPath(path)).toBe(true)
  })

  it.each([
    'packages/client/web/src/boot-client.ts',
    'docs/subsystems/README.md',
    'docs/daypaw-notes.md',
  ])('leaves %s to upstream', (path) => {
    expect(isForkOwnedPath(path)).toBe(false)
  })
})

describe('parseBundleRows', () => {
  it('pairs each id with its package name and stops at the next row', () => {
    const rows = parseBundleRows([
      '- insert:',
      '    - id: ui-chat',
      "      name: '@deepseek-ai/dsh-client-ui-chat'",
      '    - id: tools',
      '      config:',
      '        mode: !!js process.env.DSH_TOOLS_MODE',
      '    - id: message-feedback',
      "      name: '@deepseek-ai/dsh-message-feedback'",
    ].join('\n'))
    expect(rows).toEqual([
      { id: 'ui-chat', name: '@deepseek-ai/dsh-client-ui-chat', disabled: false },
      { id: 'tools', name: null, disabled: false },
      { id: 'message-feedback', name: '@deepseek-ai/dsh-message-feedback', disabled: false },
    ])
  })

  it('marks id-only rows carrying disabled: true', () => {
    const rows = parseBundleRows(['- id: workflow-ptc', '  disabled: true', ''].join('\n'))
    expect(rows).toEqual([{ id: 'workflow-ptc', name: null, disabled: true }])
  })
})

describe('parseNameStatus', () => {
  it('keeps both sides of a rename', () => {
    const entries = parseNameStatus('M\tsrc/a.ts\nR076\tsrc/old.ts\tsrc/new.ts\nD\tsrc/gone.ts')
    expect(entries).toEqual([
      { status: 'M', paths: ['src/a.ts'] },
      { status: 'R076', paths: ['src/old.ts', 'src/new.ts'] },
      { status: 'D', paths: ['src/gone.ts'] },
    ])
    expect(entryPaths(entries)).toEqual(['src/a.ts', 'src/old.ts', 'src/new.ts', 'src/gone.ts'])
  })
})

describe('computeRosterDelta', () => {
  const row = (id: string, name: string | null, disabled = false) => ({ id, name, disabled })

  it('reports added and removed rows with the fork side of each', () => {
    const delta = computeRosterDelta(
      [row('kept', '@x/kept'), row('dropped', '@x/dropped')],
      [row('kept', '@x/kept'), row('fresh', '@x/fresh')],
      [row('kept', '@x/kept'), row('dropped', '@x/dropped')],
      new Set(['@x/fresh']),
    )
    expect(delta.addedRows).toEqual([{ row: row('fresh', '@x/fresh'), isClient: true, inForkRoster: false }])
    expect(delta.removedRows).toEqual([{ row: row('dropped', '@x/dropped'), inForkRoster: true }])
  })

  it('compares disabled id sets in both directions', () => {
    const delta = computeRosterDelta(
      [row('old-disabled', null, true)],
      [row('new-disabled', null, true)],
      [],
      new Set(),
    )
    expect(delta.disabledIdsAdded).toEqual(['new-disabled'])
    expect(delta.disabledIdsRemoved).toEqual(['old-disabled'])
  })
})

describe('registry rows', () => {
  const registry = [
    '| 文件 | 改动 | 原因 | 上游 PR 候选？ | 登记批次 |',
    '|---|---|---|---|---|',
    '| `packages/util/package-manifest/src/types.ts` + `packages/client/modules/src/client/manifest.ts`（连带 `tests/{loader,node-half}.client.spec.ts`、`README(.zh)`、`docs/subsystems/client-modules.md(.zh)`） | boot wire 增行 config 通道 | why | 可提 | #105 |',
    '| ~~`packages/boot/app-boot/src/profile.ts`（#64）~~ | 已消解 | — | ~~#64~~ | 2026-08-28 sync |',
    '| `packages/client/ui-theme/src/theme-settings.ts`（连带 tests/{theme,boot-theme}.client.spec.ts） | `DEFAULT_PREFERENCE` light | why | 否 | #61 |',
    '| `tsdown.config.ts` | entry 白名单增 agents-dir | why | 否 | #66 |',
  ].join('\n')
  const present = new Set([
    'packages/util/package-manifest/src/types.ts',
    'packages/client/modules/src/client/manifest.ts',
    'packages/client/modules/tests/loader.client.spec.ts',
    'packages/client/modules/tests/node-half.client.spec.ts',
    'packages/client/modules/README.md',
    'docs/subsystems/client-modules.md',
    'packages/client/ui-theme/src/theme-settings.ts',
    'packages/client/ui-theme/tests/boot-theme.client.spec.ts',
    'tsdown.config.ts',
  ])
  const entries = parseCoreTouches(registry, path => present.has(path))

  it('expands brace globs into the files they name', () => {
    expect(expandBraces('tests/{loader,node-half}.client.spec.ts')).toEqual([
      'tests/loader.client.spec.ts',
      'tests/node-half.client.spec.ts',
    ])
  })

  it('drops the translated-twin qualifier and resolves the path it qualifies', () => {
    expect(stripQualifier('README(.zh)')).toBe('README')
    expect(packageRootOf('packages/client/modules/src/client/manifest.ts')).toBe('packages/client/modules')
    expect(entries[0]?.paths).toEqual([
      'packages/util/package-manifest/src/types.ts',
      'packages/client/modules/src/client/manifest.ts',
      'docs/subsystems/client-modules.md',
      'packages/client/modules/tests/loader.client.spec.ts',
      'packages/client/modules/tests/node-half.client.spec.ts',
      'packages/client/modules/README.md',
    ])
  })

  it('answers a resolved row with no replay', () => {
    expect(registryEntriesFor('packages/boot/app-boot/src/profile.ts', entries)).toEqual([])
  })

  it('answers a translated twin with its English row', () => {
    expect(registryEntriesFor('packages/client/modules/README.zh.md', entries).map(entry => entry.batch))
      .toEqual(['#105'])
    expect(registryEntriesFor('packages/client/modules/README.i18n.yaml', entries)).toHaveLength(1)
    expect(registryEntriesFor('packages/client/other.ts', entries)).toEqual([])
  })

  it('names a root file the row registers', () => {
    expect(registryEntriesFor('tsdown.config.ts', entries).map(entry => entry.batch)).toEqual(['#66'])
  })

  it('classifies a registered file as a registry replay and an unknown one as a gap', () => {
    expect(classifyConflict('packages/client/modules/src/index.ts', entries).kind).toBe('unregistered')
    expect(classifyConflict('packages/client/ui-theme/src/theme-settings.ts', entries).kind).toBe('registry')
    expect(classifyConflict('packages/client/modules/README.i18n.yaml', entries).kind).toBe('pairing')
    expect(classifyConflict('pnpm-lock.yaml', entries).kind).toBe('lockfile')
    expect(classifyConflict('docs/config-catalog.md', entries).kind).toBe('generated')
    expect(classifyConflict('packages/client/connection/src/client/fixture.ts', entries).kind).toBe('decision')
  })
})

describe('renderSyncPreflight', () => {
  let root: string

  const git = (...args: string[]): string => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout
  }
  const write = (path: string, content: string): void => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const commit = (message: string): string => {
    git('add', '-A')
    git('commit', '-m', message)
    return git('rev-parse', 'HEAD').trim()
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sync-preflight-'))
    git('init', '-b', 'main')
    git('config', 'user.email', 'preflight@example.test')
    git('config', 'user.name', 'preflight')
    write('docs/fork/CORE_TOUCHES.md', [
      '| 文件 | 改动 | 原因 | 上游 PR 候选？ | 登记批次 |',
      '|---|---|---|---|---|',
      '| `packages/client/web/src/shared.ts`（连带 `tests/shared.spec.ts`） | fork 行 | why | 否 | #1 |',
    ].join('\n'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('names the conflicts, the upstream deletions, and the roster deltas', () => {
    const shared = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`).join('\n')
    write(UPSTREAM_PATCH, [
      '- insert:',
      '    - id: kept',
      "      name: '@x/kept'",
      '    - id: dropped',
      "      name: '@x/dropped'",
      '- id: old-disabled',
      '  disabled: true',
    ].join('\n'))
    write(FORK_PATCH, ['- insert:', '    - id: kept', "      name: '@x/kept'"].join('\n'))
    write('packages/client/web/src/shared.ts', `${shared}\n`)
    write('packages/old-name.ts', `${shared}\n`)
    write('packages/client/connection/src/client/fixture.ts', 'fixture\n')
    write('packages/gone/package.json', '{ "name": "gone" }\n')
    write('packages/core/session/src/types.ts', 'export const SESSION_FORMAT_VERSION = 3\n')
    const base = commit('base')
    git('tag', '-a', 'daypaw-sync/2026-01-01', '-m', `upstream: owner/repo@${base}`, base)

    git('checkout', '-b', 'upstream')
    write('packages/client/web/src/shared.ts', `${shared}\nupstream line\n`)
    git('mv', 'packages/old-name.ts', 'packages/new-name.ts')
    write('packages/new-name.ts', `${shared}\nupstream line\n`)
    rmSync(join(root, 'packages/client/connection/src/client/fixture.ts'))
    rmSync(join(root, 'packages/gone'), { recursive: true })
    write('packages/core/session/src/types.ts', 'export const SESSION_FORMAT_VERSION = 4\n')
    write(UPSTREAM_PATCH, [
      '- insert:',
      '    - id: kept',
      "      name: '@x/kept'",
      '    - id: fresh',
      "      name: '@x/fresh'",
      '- id: new-disabled',
      '  disabled: true',
    ].join('\n'))
    write('packages/client/ui-fresh/package.json', '{ "name": "@x/fresh", "dsh": { "client": { "platform": "web" } } }\n')
    commit('upstream window')

    git('checkout', 'main')
    write('packages/client/web/src/shared.ts', `${shared}\nfork line\n`)
    write('packages/old-name.ts', `${shared}\nfork line\n`)
    write('packages/client/connection/src/client/fixture.ts', 'fork fixture seeds\n')
    write('packages/gone/package.json', '{ "name": "gone", "fork": true }\n')
    write('packages/daypaw/engine/src/index.ts', 'export {}\n')
    commit('fork work')

    const report = JSON.parse(renderSyncPreflight(['--head', 'upstream', '--json'], root)) as PreflightReport

    expect(report.window.baseTag).toBe('daypaw-sync/2026-01-01')
    expect(report.window.baseSha).toBe(base)
    expect(report.forkDelta).toEqual({ modified: 4, added: 1, deleted: 0 })

    const conflicting = report.conflictingFiles.map(file => file.path)
    expect(conflicting).toContain('packages/client/web/src/shared.ts')
    expect(conflicting).toContain('packages/client/connection/src/client/fixture.ts')
    expect(conflicting).not.toContain('packages/daypaw/engine/src/index.ts')
    expect(report.conflictingFiles.find(file => file.path === 'packages/client/connection/src/client/fixture.ts')?.upstreamDeleted)
      .toBe(true)
    expect(report.conflictingFiles.find(file => file.path === 'packages/client/web/src/shared.ts')?.insertions).toBe(1)

    expect(report.renameTouches).toEqual([{
      forkPath: 'packages/old-name.ts',
      from: 'packages/old-name.ts',
      to: 'packages/new-name.ts',
    }])
    expect(report.deletedPackages).toEqual(['packages/gone/package.json'])
    expect(report.roster.addedRows).toEqual([{
      row: { id: 'fresh', name: '@x/fresh', disabled: false },
      isClient: true,
      inForkRoster: false,
    }])
    expect(report.roster.disabledIdsAdded).toEqual(['new-disabled'])
    expect(report.roster.disabledIdsRemoved).toEqual(['old-disabled'])
    expect(report.hazards.sessionFormatVersion).toEqual({ base: '3', head: '4' })
    expect(report.hazards.fixtureFileDeleted).toBe(true)
    expect(report.replayPlan).toContainEqual({
      path: 'packages/client/web/src/shared.ts',
      kind: 'registry',
      instruction: '重放登记行（#1）：fork 行',
    })
    expect(report.replayPlan.find(step => step.path === 'packages/gone/package.json')?.kind).toBe('unregistered')
  })

  it('renders the text report when --json is absent', () => {
    write('packages/kept.ts', 'kept\n')
    commit('base')
    git('tag', '-a', 'daypaw-sync/2026-01-01', '-m', `upstream: owner/repo@${git('rev-parse', 'HEAD').trim()}`, 'HEAD')
    const text = renderSyncPreflight(['--head', 'HEAD'], root)
    expect(text).toContain('sync preflight — daypaw-sync/2026-01-01')
    expect(text).toContain('## conflicting files')
    expect(text).toContain('## replay plan')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('fails loud when no checkpoint tag records a base', () => {
    write('packages/kept.ts', 'kept\n')
    commit('base')
    expect(() => renderSyncPreflight(['--head', 'HEAD'], root)).toThrow(/no daypaw-sync\/\* tag/)
  })
})
