/**
 * Ticket #92's executed proof that the upstream `session-turn-outline`
 * capability and the fork's durable right-column read model coexist:
 * the roster facts the surface ships (outline row taken, schedule row
 * mirrored upstream's disabled state) and one composed host tree where the
 * `turnOutline` session projection and the engine's `durable/journalTimeline`
 * Remote answer side by side — session-projection seam and durable engine
 * seam, distinct keys, no shared surface.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionTurnOutline from '@deepseek-ai/dsh-session-turn-outline'
// Type-only: pulls the turnOutline key's SessionProjectionMap merge into this
// program (the host-face parallel of ui-chat's client type-only import).
import type {} from '@deepseek-ai/dsh-session-turn-outline/types'
import { DurableEngine } from '@daypaw/sdk'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.length = 0
})

/** The two patch layers `dsh web` composes for the daypaw surface, in order. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const BUNDLE_LAYERS = [
  join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml'),
  join(REPO_ROOT, 'packages/daypaw/web-app/cordis.patch.yml'),
] as const

interface ComposedEntry {
  name?: unknown
  disabled?: unknown
}

/** Compose the fork web surface's roster rows exactly as the profile does. */
function composedRoster(): readonly ComposedEntry[] {
  return composeEntries(BUNDLE_LAYERS.map(patch => loadOverlayPatches('roster coexistence', patch)))
}

describe('roster rows (ticket #92)', () => {
  it('takes the session-turn-outline row enabled and mirrors ui-schedule disabled', () => {
    const rows = new Map<string, { enabled: boolean }>()
    for (const entry of composedRoster()) {
      if (typeof entry.name !== 'string') continue
      // Later layers override by id, so the fork's row wins over any base row.
      rows.set(entry.name, { enabled: entry.disabled !== true })
    }
    expect(rows.get('@deepseek-ai/dsh-session-turn-outline')).toEqual({ enabled: true })
    expect(rows.get('@deepseek-ai/dsh-client-ui-schedule')).toEqual({ enabled: false })
  })
})

describe('turnOutline and durable/journalTimeline over one composition (ticket #92)', () => {
  it('serves both read models side by side: distinct seams, distinct keys', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(DurableEngine, { path: ':memory:', pollMs: 20 })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionTurnOutline)

    // Durable seam: one journaled workflow run answers the engine's timeline.
    const def = {
      kind: 'workflow',
      name: 'outline-coexists',
      version: '1',
      body: async (run: { step: (key: string, body: () => Promise<unknown>) => Promise<unknown> }) => {
        await run.step('collect', async () => 'ok')
        return 'done'
      },
    } as const
    await ctx.durable.register(def)
    const handle = await ctx.durable.run(def, null)
    await handle.result
    expect((await ctx.durable.journalTimeline(handle.id)).map(row => row.name)).toEqual(['collect'])

    // Session-projection seam: the same tree serves the whole-log outline.
    const session = ctx.sessions.create(SessionId('outline-session'))
    const boundary = session.append('turn/start', { turn: 1 }).seq
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '组合并存的提示' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'settled answer' }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.turnOutline).toEqual([
      { turn: 1, seq: boundary, prompt: '组合并存的提示', response: 'settled answer' },
    ])
  })
})
