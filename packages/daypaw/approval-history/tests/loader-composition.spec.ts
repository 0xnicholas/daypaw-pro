/**
 * REAL-composition proof: the shipped YAML shape (session + projection
 * registry + approval-history) boots through the vendored Loader, the function
 * plugin's namespace survives (no default export), and one logged
 * asked/decided pair serves the paired entry through the composed registry.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-user-approval'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import * as ApprovalHistoryPlugin from '@daypaw/approval-history'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'daypaw-approval-history-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@daypaw/approval-history', ApprovalHistoryPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped approval-history YAML shape and serves the paired audit entry', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@daypaw/approval-history'",
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const session = loaded.sessions.create(SessionId('composed'))
    session.append('approval/asked', { id: ApprovalRequestId('req-1'), toolName: 'bash' })
    session.append('approval/decided', { id: ApprovalRequestId('req-1'), outcome: 'unavailable' })
    expect(loaded.sessionProjections.snapshot(session).values.approvalHistory)
      .toEqual([{ id: 'req-1', toolName: 'bash', outcome: 'unavailable' }])
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    // A default export beside the named form makes the Loader discard the
    // namespace (postmortem 0001) — pin its absence.
    expect('default' in ApprovalHistoryPlugin).toBe(false)
  })
})
