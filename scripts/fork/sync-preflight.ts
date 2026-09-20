/**
 * Measure an upstream sync window and name the fork's port friction before the
 * merge starts: drift volume, the files both sides changed, package renames,
 * bundle-roster row deltas, and probes for the hazards a sync carries.
 *
 * Read-only: it runs git plumbing and never touches the working tree.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const FORMAT_VERSION = 2
const MAX_GIT_OUTPUT = 256 * 1024 * 1024
const UPSTREAM_WEB_PATCH = 'packages/bundle/web-app/cordis.patch.yml'
const FORK_WEB_PATCH = 'packages/daypaw/web-app/cordis.patch.yml'
const CORE_TOUCHES = 'docs/fork/CORE_TOUCHES.md'
const NOTHING = ''

/** Repository-relative path prefixes that make a backticked token a path. */
const REPO_TOP_LEVELS = [
  'packages/', 'apps/', 'scripts/', 'docs/', 'snapshots/', '.agents/', 'python/', 'website/', 'vendor/', 'benchmarks/',
] as const

/** Root files whose backticked mention names a path without a directory. */
const ROOT_FILES = [
  'package.json', 'AGENTS.md', 'CLAUDE.md', 'CONTEXT.md', 'THIRD_PARTY_NOTICES.md', 'pnpm-lock.yaml',
  'tsconfig.base.json', 'tsconfig.host.json', 'tsconfig.client.json', 'tsconfig.json', 'vitest.config.ts',
  'vitest.web.daypaw.config.ts', 'lefthook.yml', '.gitignore',
] as const

/**
 * Documents a repository generator rewrites, mapped to the script that owns
 * them: a sync replays these by regenerating, never by hand-merging.
 */
const GENERATED_OUTPUTS: readonly { readonly prefix: string; readonly generator: string }[] = [
  { prefix: 'docs/config-catalog.', generator: 'gen-config-catalog' },
  { prefix: 'docs/capability-seams.', generator: 'gen-doc-graphs' },
  { prefix: 'docs/module-graph.', generator: 'gen-doc-graphs' },
  { prefix: 'docs/agent-lifecycle.', generator: 'gen-doc-graphs' },
  { prefix: 'docs/event-producer-consumer.', generator: 'gen-doc-graphs' },
  { prefix: 'docs/graph-atlas.', generator: 'gen-doc-graphs' },
  { prefix: 'docs/tool-execution-pipeline.', generator: 'gen-doc-graphs' },
  { prefix: 'docs/tool-catalog.', generator: 'gen-tool-catalog' },
  { prefix: 'docs/persistence-catalog.', generator: 'gen-persistence-catalog' },
  { prefix: 'docs/cordis-api/', generator: 'gen-cordis-catalog' },
  { prefix: 'docs/dependency-catalog.json', generator: 'dependency-catalog' },
  { prefix: 'packages/extensions/tool-cordis/src/api-catalog.ts', generator: 'gen-cordis-api' },
  { prefix: 'packages/extensions/cordis-client-runner/src/client/api-catalog.ts', generator: 'gen-cordis-inspect-catalog' },
  { prefix: 'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts', generator: 'gen-client-catalog' },
  { prefix: 'THIRD_PARTY_NOTICES.md', generator: 'gen-third-party-notices' },
  { prefix: 'website/', generator: 'website build' },
] as const

/** Path prefixes owned by the fork; a fork-owned path never conflicts with upstream. */
const FORK_OWNED_PREFIXES = [
  'packages/daypaw/',
  'apps/daypaw-web/',
  'packages/examples/daypaw-skeleton/',
  'docs/adr/',
  'docs/spec/',
  'docs/research/',
  'docs/reports/',
  'docs/agents/',
  'docs/fork/',
  'CONTEXT.md',
  'daypaw/',
] as const

/** One row of a bundle patch: a named row, or an id-only row carrying `disabled`. */
export interface BundleRow {
  readonly id: string
  readonly name: string | null
  readonly disabled: boolean
}

/** A file both the fork and upstream changed inside the window. */
export interface ConflictingFile {
  readonly path: string
  readonly insertions: number
  readonly deletions: number
  readonly upstreamDeleted: boolean
}

/** One registry row of `docs/fork/CORE_TOUCHES.md`. */
export interface CoreTouchEntry {
  readonly paths: readonly string[]
  readonly change: string
  readonly batch: string
  readonly resolved: boolean
}

/** How a sync replays one conflicting file. */
export type ReplayKind = 'decision' | 'registry' | 'generated' | 'pairing' | 'lockfile' | 'unregistered'

/** One step of the sync replay plan. */
export interface ReplayStep {
  readonly path: string
  readonly kind: ReplayKind
  readonly instruction: string
}

/** Bundle-roster rows added or removed upstream, with the fork's side of each. */
export interface RosterDelta {
  readonly addedRows: readonly { row: BundleRow; isClient: boolean; inForkRoster: boolean }[]
  readonly removedRows: readonly { row: BundleRow; inForkRoster: boolean }[]
  readonly disabledIdsAdded: readonly string[]
  readonly disabledIdsRemoved: readonly string[]
}

/** A file upstream renamed out from under a path the fork had changed. */
export interface RenameTouch {
  readonly forkPath: string
  readonly from: string
  readonly to: string
}

/** Everything one preflight run measures. */
export interface PreflightReport {
  readonly formatVersion: typeof FORMAT_VERSION
  readonly window: {
    readonly baseTag: string
    readonly baseSha: string
    readonly headRef: string
    readonly headSha: string
    readonly commits: number
    readonly commitsWithoutMerges: number
    readonly filesChanged: number
    readonly shortstat: string
    readonly latestCommit: string
  }
  readonly forkDelta: { readonly modified: number; readonly added: number; readonly deleted: number }
  readonly conflictingFiles: readonly ConflictingFile[]
  readonly addedBothSides: readonly string[]
  readonly renameTouches: readonly RenameTouch[]
  readonly deletedPackages: readonly string[]
  readonly renamedPackages: readonly { readonly from: string; readonly to: string }[]
  readonly roster: RosterDelta
  readonly replayPlan: readonly ReplayStep[]
  readonly hazards: Readonly<Record<string, unknown>>
}

interface NameStatusEntry {
  readonly status: string
  readonly paths: readonly string[]
}

/**
 * Read the upstream sha a checkpoint tag records in its message.
 * @param subject - The tag's message subject, e.g. `upstream: owner/repo@abc1234`.
 * @returns The recorded sha, or undefined when the message carries none.
 */
export function parseCheckpointUpstreamSha(subject: string): string | undefined {
  return /@([0-9a-f]{7,40})\b/.exec(subject)?.[1]
}

/**
 * Decide whether a repository path belongs to the fork rather than to upstream.
 * @param path - Repository-relative path.
 * @returns True when the path is fork-owned and therefore cannot conflict with upstream.
 */
export function isForkOwnedPath(path: string): boolean {
  return FORK_OWNED_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix))
}

/**
 * Read a bundle patch's rows: `- id: X` blocks that name a package, plus
 * id-only rows that carry `disabled: true`.
 * @param text - Bundle patch YAML.
 * @returns Every row in file order.
 */
export function parseBundleRows(text: string): BundleRow[] {
  const lines = text.split('\n')
  const rows: BundleRow[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const id = /^\s*-\s*id:\s*(\S+)/.exec(lines[index] ?? '')
    if (id?.[1] === undefined) continue
    let name: string | null = null
    let disabled = false
    for (let probe = index + 1; probe < Math.min(index + 8, lines.length); probe += 1) {
      const line = lines[probe] ?? ''
      const named = /^\s*name:\s*'?([^'\s]+)'?/.exec(line)
      if (named?.[1] !== undefined) {
        name = named[1]
        break
      }
      if (/^\s*disabled:\s*true/.test(line)) disabled = true
      if (/^\s*-\s*id:/.test(line)) break
    }
    rows.push({ id: id[1], name, disabled })
  }
  return rows
}

/**
 * Parse `git diff --name-status -M` output.
 * @param text - Diff output, one `<status>\t<path>` (or `R<score>\t<from>\t<to>`) per line.
 * @returns One entry per line.
 */
export function parseNameStatus(text: string): NameStatusEntry[] {
  return text.split('\n')
    .filter(line => line !== NOTHING)
    .map((line) => {
      const [status = NOTHING, ...paths] = line.split('\t')
      return { status, paths }
    })
}

/**
 * Every path a diff entry names, including both sides of a rename.
 * @param entries - Parsed name-status entries.
 * @returns Distinct paths in first-seen order.
 */
export function entryPaths(entries: readonly NameStatusEntry[]): string[] {
  const seen = new Set<string>()
  for (const entry of entries) {
    for (const path of entry.status.startsWith('R') || entry.status.startsWith('C') ? entry.paths : entry.paths.slice(0, 1)) {
      seen.add(path)
    }
  }
  return [...seen]
}

/**
 * Compare an upstream web-bundle roster before and after the window.
 * @param before - Rows at the window base.
 * @param after - Rows at the window head.
 * @param forkRows - Rows of the fork's own web bundle patch.
 * @param clientPackages - Package names that declare a browser half.
 * @returns Added, removed, and disabled-id deltas keyed for the mirror check.
 */
export function computeRosterDelta(
  before: readonly BundleRow[],
  after: readonly BundleRow[],
  forkRows: readonly BundleRow[],
  clientPackages: ReadonlySet<string>,
): RosterDelta {
  const forkNames = new Set(forkRows.flatMap(row => (row.name === null ? [] : [row.name])))
  const namedBefore = before.filter(row => row.name !== null)
  const namedAfter = after.filter(row => row.name !== null)
  const disabledBefore = new Set(before.filter(row => row.disabled).map(row => row.id))
  const disabledAfter = new Set(after.filter(row => row.disabled).map(row => row.id))
  return {
    addedRows: namedAfter
      .filter(row => !namedBefore.some(candidate => candidate.name === row.name))
      .map(row => ({ row, isClient: clientPackages.has(row.name ?? NOTHING), inForkRoster: forkNames.has(row.name ?? NOTHING) })),
    removedRows: namedBefore
      .filter(row => !namedAfter.some(candidate => candidate.name === row.name))
      .map(row => ({ row, inForkRoster: forkNames.has(row.name ?? NOTHING) })),
    disabledIdsAdded: [...disabledAfter].filter(id => !disabledBefore.has(id)).sort(),
    disabledIdsRemoved: [...disabledBefore].filter(id => !disabledAfter.has(id)).sort(),
  }
}

interface GitResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const isPathToken = (token: string): boolean => REPO_TOP_LEVELS.some(level => token.startsWith(level))
  || ROOT_FILES.includes(token as typeof ROOT_FILES[number])
  || /^[\w.-]+\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|md|sh)$/.test(token)

/** Path-like mentions in a registry cell: an extension-bearing token, or a bare document name. */
const PATH_LIKE = /[A-Za-z0-9_][A-Za-z0-9_./{},()-]*\.(?:ts|tsx|json|ya?ml|md|sh|mjs|cjs)|(?:README|AGENTS|CLAUDE)(?:\([^()]*\))?/g

/** Expand one `{a,b}` group, recursively, so a registry row's brace glob names real files. */
export function expandBraces(token: string): string[] {
  const match = /\{([^{}]*)\}/.exec(token)
  if (match?.[1] === undefined) return [token]
  const head = token.slice(0, match.index)
  const tail = token.slice(match.index + match[0].length)
  return match[1].split(',').flatMap(part => expandBraces(`${head}${part}${tail}`))
}

/** Drop a trailing `(.zh)`-style qualifier so the token names the English file. */
export function stripQualifier(token: string): string {
  return token.replace(/\([^()]*\)$/, NOTHING)
}

/** The package directory a registry path belongs to, for resolving relative tokens. */
export function packageRootOf(path: string): string {
  const segments = path.split('/')
  if (segments[0] === 'packages') return segments.slice(0, 3).join('/')
  if (segments[0] === 'apps') return segments.slice(0, 2).join('/')
  return segments.slice(0, -1).join('/')
}

/**
 * Read the sync registry rows of `docs/fork/CORE_TOUCHES.md`.
 *
 * Leading backticked tokens name the registered files; a parenthesised note may
 * name further files relative to the registered package root (resolved through
 * `exists`), and a row whose first cell is struck through is already resolved.
 * @param text - The registry document.
 * @param exists - Predicate deciding which relative-path candidate exists in the tree.
 * @returns One entry per registry row, in file order.
 */
export function parseCoreTouches(text: string, exists: (path: string) => boolean): CoreTouchEntry[] {
  const entries: CoreTouchEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    const first = cells[0]
    if (first === undefined || first === '文件' || /^-+$/.test(first)) continue
    const resolved = first.startsWith('~~')
    const quoted = [...first.matchAll(/`([^`]+)`/g)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
    const bare = [...first.matchAll(PATH_LIKE)].map(match => match[0])
    const tokens = [...new Set([...quoted, ...bare].flatMap(expandBraces).map(stripQualifier))]
    const primary = tokens.filter(isPathToken)
    const paths = [...primary]
    const resolve = (candidate: string): void => {
      if (exists(candidate) && !paths.includes(candidate)) paths.push(candidate)
    }
    for (const token of tokens) {
      for (const anchor of primary) {
        if (anchor === token || !token.includes('/')) {
          const root = packageRootOf(anchor)
          if (token !== anchor) {
            resolve(`${root}/${token}`)
            resolve(`${root}/${token}.md`)
          }
          continue
        }
        resolve(`${packageRootOf(anchor)}/${token}`)
        resolve(`${anchor.slice(0, anchor.lastIndexOf('/'))}/${token}`)
      }
    }
    entries.push({ paths, change: cells[1] ?? NOTHING, batch: cells.at(-1) ?? NOTHING, resolved })
  }
  return entries
}

/**
 * The live registry rows that name a path, or its English twin when the path is
 * a translated counterpart (`.zh.md`, `.i18n.yaml`).
 * @param path - Repository-relative path.
 * @param entries - Registry rows.
 * @returns Rows naming the path and not already resolved.
 */
export function registryEntriesFor(path: string, entries: readonly CoreTouchEntry[]): CoreTouchEntry[] {
  const twins = [
    path,
    ...(path.endsWith('.zh.md') ? [path.slice(0, -'.zh.md'.length) + '.md'] : []),
    ...(path.endsWith('.i18n.yaml') ? [path.slice(0, -'.i18n.yaml'.length) + '.md'] : []),
  ]
  return entries.filter(entry => !entry.resolved && twins.some(twin => entry.paths.includes(twin)))
}

/**
 * Name the replay a conflicting file needs.
 * @param path - Repository-relative path both sides changed.
 * @param entries - Registry rows.
 * @returns The replay step for this path.
 */
export function classifyConflict(path: string, entries: readonly CoreTouchEntry[]): ReplayStep {
  if (path === 'packages/client/connection/src/client/fixture.ts' || path.endsWith('/fixture.client.spec.ts')) {
    return { path, kind: 'decision', instruction: '上游删除了浏览器 fixture；先裁新家（见地图上的迁移方案草稿），不要边合边试' }
  }
  if (path === 'pnpm-lock.yaml') {
    return { path, kind: 'lockfile', instruction: '跑 pnpm install 重出锁文件' }
  }
  const generated = GENERATED_OUTPUTS.find(entry => path.startsWith(entry.prefix))
  if (generated !== undefined) {
    return { path, kind: 'generated', instruction: `生成物：跑 ${generated.generator} 重出（verify-* 门校验新鲜度）` }
  }
  if (path.endsWith('.i18n.yaml')) {
    return { path, kind: 'pairing', instruction: '双语配对记录：解决内容冲突后 pnpm run verify-translation-pairing --write <英文侧路径>' }
  }
  const registered = registryEntriesFor(path, entries)
  if (registered.length > 0) {
    return { path, kind: 'registry', instruction: `重放登记行（${registered.map(entry => entry.batch).join(' / ')}）：${registered[0]?.change.slice(0, 160) ?? NOTHING}` }
  }
  return { path, kind: 'unregistered', instruction: '登记缺口：fork 改过该上游文件而 CORE_TOUCHES 无行——确认改动意图后补登记，或取上游版本' }
}

function git(cwd: string, args: readonly string[]): GitResult {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Run git and fail loud on a non-zero status; an empty stdout is a valid answer. */
function gitOk(cwd: string, args: readonly string[]): string {
  const result = git(cwd, args)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

/** Run git and return undefined when the command fails, for probe-style reads. */
function gitOrUndefined(cwd: string, args: readonly string[]): string | undefined {
  const result = git(cwd, args)
  return result.status === 0 ? result.stdout : undefined
}

const trimmedLines = (text: string): string[] => text.trimEnd().split('\n').filter(line => line !== NOTHING)

/** The newest checkpoint tag and the upstream sha it records. */
function latestCheckpoint(cwd: string): { tag: string; sha: string } {
  const tags = trimmedLines(gitOk(cwd, [
    'for-each-ref', '--format=%(refname:short)', '--sort=-creatordate', 'refs/tags/daypaw-sync/*',
  ]))
  const tag = tags[0]
  if (tag === undefined) throw new Error('no daypaw-sync/* tag records a sync base; pass --base')
  const subject = gitOk(cwd, ['for-each-ref', '--format=%(contents:subject)', `refs/tags/${tag}`])
  const sha = parseCheckpointUpstreamSha(subject)
  if (sha === undefined) throw new Error(`${tag}: the tag message records no upstream sha; pass --base`)
  return { tag, sha }
}

/** Package names whose workspace manifest declares a browser half, from one tree. */
function clientPackages(cwd: string, revision: string): Set<string> {
  const manifests = trimmedLines(gitOk(cwd, ['ls-tree', '-r', '--name-only', revision, 'packages/', 'apps/']))
    .filter(path => path.endsWith('package.json'))
  const names = new Set<string>()
  for (const path of manifests) {
    const text = gitOrUndefined(cwd, ['show', `${revision}:${path}`])
    if (text === undefined) continue
    let manifest: { name?: unknown; dsh?: { client?: { platform?: unknown } } }
    try {
      manifest = JSON.parse(text) as typeof manifest
    } catch {
      // Generated or fixture manifests need not be JSON; a package that does not
      // parse cannot declare a browser half, so the roster check skips it.
      continue
    }
    const platform = manifest.dsh?.client?.platform
    const webPlatform = platform === 'web' || (Array.isArray(platform) && platform.includes('web'))
    if (typeof manifest.name === 'string' && webPlatform) names.add(manifest.name)
  }
  return names
}

function bundleRowsAt(cwd: string, revision: string, path: string): BundleRow[] {
  const text = gitOrUndefined(cwd, ['show', `${revision}:${path}`])
  return text === undefined ? [] : parseBundleRows(text)
}

/** Replay kinds in the order a sync works through them. */
const ORDER_OF_KINDS: readonly ReplayKind[] = ['decision', 'lockfile', 'generated', 'pairing', 'registry', 'unregistered']

/** Count replay steps per kind. */
function groupCounts(steps: readonly ReplayStep[]): Partial<Record<ReplayKind, number>> {
  const counts: Partial<Record<ReplayKind, number>> = {}
  for (const step of steps) counts[step.kind] = (counts[step.kind] ?? 0) + 1
  return counts
}

function renderReport(report: PreflightReport): string {
  const lines: string[] = []
  lines.push(`# sync preflight — ${report.window.baseTag} (${report.window.baseSha.slice(0, 10)}) → ${report.window.headRef} (${report.window.headSha.slice(0, 10)})`)
  lines.push('')
  lines.push(`drift: ${report.window.commits} commits (${report.window.commitsWithoutMerges} without merges), ${report.window.filesChanged} files`)
  lines.push(`  ${report.window.shortstat}`)
  lines.push(`  head: ${report.window.latestCommit}`)
  lines.push(`fork delta: M ${report.forkDelta.modified} / A ${report.forkDelta.added} / D ${report.forkDelta.deleted}`)
  lines.push('')
  lines.push(`## conflicting files (the fork changed them and so did upstream) — ${report.conflictingFiles.length}`)
  for (const file of report.conflictingFiles) {
    lines.push(`  ${file.upstreamDeleted ? 'DELETED ' : ''}+${file.insertions}/-${file.deletions}\t${file.path}`)
  }
  lines.push(`## added on both sides — ${report.addedBothSides.length}`)
  for (const path of report.addedBothSides) lines.push(`  ${path}`)
  lines.push(`## renames that touch a fork-changed path — ${report.renameTouches.length}`)
  for (const touch of report.renameTouches) lines.push(`  ${touch.from} → ${touch.to}  (fork changed ${touch.forkPath})`)
  lines.push('## packages deleted upstream')
  for (const path of report.deletedPackages) lines.push(`  D ${path}`)
  lines.push('## packages renamed upstream')
  for (const entry of report.renamedPackages) lines.push(`  R ${entry.from} → ${entry.to}`)
  lines.push('## upstream web bundle roster')
  for (const entry of report.roster.addedRows) {
    lines.push(`  + ${entry.row.id} ${entry.row.name}${entry.isClient ? ' [client]' : ''}${entry.inForkRoster ? ' — fork has it' : ' — fork lacks it'}`)
  }
  for (const entry of report.roster.removedRows) {
    lines.push(`  - ${entry.row.id} ${entry.row.name}${entry.inForkRoster ? ' — fork still holds it' : ''}`)
  }
  lines.push(`  disabled ids: +[${report.roster.disabledIdsAdded.join(', ')}] -[${report.roster.disabledIdsRemoved.join(', ')}]`)
  lines.push('## replay plan')
  const counts = groupCounts(report.replayPlan)
  const summary = ORDER_OF_KINDS.map(kind => `${kind} ${String(counts[kind] ?? 0)}`).join(' / ')
  lines.push(`  ${String(report.replayPlan.length)} files: ${summary}`)
  for (const kind of ORDER_OF_KINDS) {
    const steps = report.replayPlan.filter(step => step.kind === kind)
    if (steps.length === 0) continue
    lines.push(`### ${kind} (${steps.length})`)
    for (const step of steps) lines.push(`  ${step.path} — ${step.instruction}`)
  }
  lines.push('## hazard probes')
  for (const [key, value] of Object.entries(report.hazards)) {
    lines.push(`  ${key}: ${JSON.stringify(value)}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Measure the window between a checkpoint's upstream sha and a later upstream ref.
 * @param args - `--base <ref>`, `--head <ref>`, `--json`.
 * @param cwd - A directory inside the fork's worktree.
 * @returns The rendered report, JSON or text, with a trailing newline.
 */
export function renderSyncPreflight(args: string[], cwd: string): string {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'upstream/master' },
      json: { type: 'boolean', default: false },
    },
  })
  const headRef = values.head
  const explicitBase = values.base
  const checkpoint = explicitBase === undefined
    ? latestCheckpoint(cwd)
    : { tag: '(explicit --base)', sha: explicitBase }
  const baseSha = gitOk(cwd, ['rev-parse', checkpoint.sha]).trim()
  const headSha = gitOk(cwd, ['rev-parse', headRef]).trim()
  const mergeBase = gitOk(cwd, ['merge-base', 'HEAD', headSha]).trim()
  const range = `${baseSha}..${headSha}`

  const windowEntries = parseNameStatus(gitOk(cwd, ['diff', '--name-status', '-M', range]))
  const windowChanged = new Set(entryPaths(windowEntries))
  const windowDeleted = new Set(windowEntries.filter(entry => entry.status === 'D').map(entry => entry.paths[0] ?? NOTHING))
  const windowRenamed = windowEntries
    .filter(entry => entry.status.startsWith('R'))
    .flatMap(entry => (entry.paths[0] === undefined || entry.paths[1] === undefined ? [] : [{ from: entry.paths[0], to: entry.paths[1] }]))

  const forkEntries = parseNameStatus(gitOk(cwd, ['diff', '--name-status', '-M', `${mergeBase}..HEAD`]))
  const forkPathList = (status: string): string[] => forkEntries
    .filter(entry => entry.status === status)
    .flatMap(entry => entry.paths.slice(0, 1))
  const forkModified = forkPathList('M')
  const forkAdded = forkPathList('A')

  const numstat = (path: string): { insertions: number; deletions: number } => {
    const text = gitOk(cwd, ['diff', '--numstat', range, '--', path])
    const [insertions = '0', deletions = '0'] = text.split('\t')
    return { insertions: Number(insertions), deletions: Number(deletions) }
  }

  const conflictingFiles = forkModified
    .filter(path => !isForkOwnedPath(path) && windowChanged.has(path))
    .map(path => ({ path, ...numstat(path), upstreamDeleted: windowDeleted.has(path) }))
    .sort((left, right) => (right.insertions + right.deletions) - (left.insertions + left.deletions))

  const addedBothSides = forkAdded.filter(path => !isForkOwnedPath(path) && windowChanged.has(path))
  const renameTouches = forkModified
    .filter(path => !isForkOwnedPath(path))
    .flatMap(forkPath => windowRenamed
      .filter(entry => entry.from === forkPath || entry.to === forkPath)
      .map(entry => ({ forkPath, from: entry.from, to: entry.to })))

  const roster = computeRosterDelta(
    bundleRowsAt(cwd, baseSha, UPSTREAM_WEB_PATCH),
    bundleRowsAt(cwd, headSha, UPSTREAM_WEB_PATCH),
    bundleRowsAt(cwd, 'HEAD', FORK_WEB_PATCH),
    clientPackages(cwd, headSha),
  )

  const fileDelta = (path: string): string => {
    const text = gitOk(cwd, ['diff', '--numstat', range, '--', path]).trim()
    return text === NOTHING ? 'unchanged' : text
  }
  const registry = parseCoreTouches(
    readFileSync(join(cwd, CORE_TOUCHES), 'utf8'),
    path => existsSync(join(cwd, path)),
  )
  const replayPlan = [...new Set([...conflictingFiles.map(file => file.path), ...addedBothSides])]
    .map(path => classifyConflict(path, registry))
  const formatVersion = (revision: string): string => {
    const text = gitOrUndefined(cwd, ['show', `${revision}:packages/core/session/src/types.ts`])
    return text?.match(/SESSION_FORMAT_VERSION\s*=\s*(\d+)/)?.[1] ?? 'unknown'
  }
  const frozenArchiveViolations = (): string[] => {
    const upstreamArchived = new Set(trimmedLines(gitOk(cwd, ['ls-tree', '-r', '--name-only', headSha, '.agents/notes/archived/'])))
    return trimmedLines(gitOk(cwd, ['diff', '--name-only', '-M', mergeBase, 'HEAD', '--', '.agents/notes/archived/**']))
      .filter(path => upstreamArchived.has(path))
  }

  const report: PreflightReport = {
    formatVersion: FORMAT_VERSION,
    window: {
      baseTag: checkpoint.tag,
      baseSha,
      headRef,
      headSha,
      commits: Number(gitOk(cwd, ['rev-list', '--count', range]).trim()),
      commitsWithoutMerges: Number(gitOk(cwd, ['rev-list', '--count', '--no-merges', range]).trim()),
      filesChanged: windowEntries.length,
      shortstat: gitOk(cwd, ['diff', '--shortstat', range]).trim(),
      latestCommit: gitOk(cwd, ['log', '-1', '--format=%h %ad %s', '--date=short', headSha]).trim(),
    },
    forkDelta: { modified: forkModified.length, added: forkAdded.length, deleted: forkPathList('D').length },
    conflictingFiles,
    addedBothSides,
    renameTouches,
    deletedPackages: windowEntries
      .filter(entry => entry.status === 'D' && (entry.paths[0] ?? NOTHING).endsWith('package.json'))
      .map(entry => entry.paths[0] ?? NOTHING),
    renamedPackages: windowRenamed.filter(entry => entry.to.endsWith('package.json')),
    roster,
    replayPlan,
    hazards: {
      sessionFormatVersion: { base: formatVersion(baseSha), head: formatVersion(headSha) },
      runCliExportedAtHead: (gitOrUndefined(cwd, ['grep', '-l', 'export async function runCli', headSha, '--', 'apps/cli/src']) ?? NOTHING) !== NOTHING,
      frozenArchiveViolations: frozenArchiveViolations(),
      fixtureFileDeleted: windowDeleted.has('packages/client/connection/src/client/fixture.ts'),
      fixtureDelta: fileDelta('packages/client/connection/src/client/fixture.ts'),
      assembledBootDelta: fileDelta('apps/web/tests/assembled-boot.ts'),
      vendoredBinDelta: fileDelta('apps/cli/src/bin.ts'),
    },
  }
  return values.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report)
}

const entryPath = process.argv[1]
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(renderSyncPreflight(process.argv.slice(2), process.cwd()))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`sync-preflight: ${message}\n`)
    process.exitCode = 1
  }
}
