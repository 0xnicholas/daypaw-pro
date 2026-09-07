/**
 * Executed roster facts for the fork web surface, plus ticket #92's
 * coexistence proof: the roster rows the surface ships (turn-outline taken,
 * schedule mirrored disabled, the ticket #104 attachment and reference
 * client rows taken) compose through the real `dsh-app-boot` patch layering,
 * and one composed host tree answers the `turnOutline` session projection and
 * the engine's `durable/journalTimeline` Remote side by side —
 * session-projection seam and durable engine seam, distinct keys, no shared
 * surface.
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
import type { EngineStepCtx } from '@daypaw/engine'

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

/** Map composed rows by package name to the profile's final enabled state. */
function rosterByName(): Map<string, { enabled: boolean }> {
  const rows = new Map<string, { enabled: boolean }>()
  for (const entry of composedRoster()) {
    if (typeof entry.name !== 'string') continue
    // Later layers override by id, so the fork's row wins over any base row.
    rows.set(entry.name, { enabled: entry.disabled !== true })
  }
  return rows
}

describe('roster rows (ticket #92)', () => {
  it('takes the session-turn-outline row enabled and mirrors ui-schedule disabled', () => {
    const rows = rosterByName()
    expect(rows.get('@deepseek-ai/dsh-session-turn-outline')).toEqual({ enabled: true })
    expect(rows.get('@deepseek-ai/dsh-client-ui-schedule')).toEqual({ enabled: false })
  })
})

describe('roster rows (ticket #104)', () => {
  it("takes the ui-attachment and ui-reference rows enabled, with ui-reference's service rows mounted", () => {
    const rows = rosterByName()
    expect(rows.get('@deepseek-ai/dsh-client-ui-attachment')).toEqual({ enabled: true })
    expect(rows.get('@deepseek-ai/dsh-client-ui-reference')).toEqual({ enabled: true })
    // ui-reference's candidate domains resolve from these Host service rows.
    expect(rows.get('@deepseek-ai/dsh-file-reference-local')).toEqual({ enabled: true })
    expect(rows.get('@deepseek-ai/dsh-session-reference')).toEqual({ enabled: true })
  })
})

describe('roster rows (ticket #103)', () => {
  it('keeps the agent-plane tool rows live on the host plane', () => {
    const rows = rosterByName()
    // The model-side tool line the base composes stays enabled through this
    // overlay, so every agent inherits the global tools layer (ADR 0013 §3).
    for (const name of [
      '@deepseek-ai/dsh-tool-bash',
      '@deepseek-ai/dsh-tool-pwsh',
      '@deepseek-ai/dsh-tool-jobs',
      '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-fs-search',
      '@deepseek-ai/dsh-tool-str-replace-editor',
      '@deepseek-ai/dsh-skill-filesystem',
      '@deepseek-ai/dsh-tool-skill',
      '@deepseek-ai/dsh-tool-goal',
      '@deepseek-ai/dsh-plan-mode',
      '@deepseek-ai/dsh-compaction-basic',
      '@deepseek-ai/dsh-command-compact',
      '@deepseek-ai/dsh-compaction-tool-result-pruner',
      '@deepseek-ai/dsh-tool-subagent-control',
      '@deepseek-ai/dsh-tool-subagent-control/list-agents',
      '@deepseek-ai/dsh-tool-subagent',
      '@deepseek-ai/dsh-workflow-worker-thread',
      '@deepseek-ai/dsh-tool-workflow',
      '@deepseek-ai/dsh-tool-ralph',
      '@deepseek-ai/dsh-agent-instructions',
      '@deepseek-ai/dsh-tool-todo',
      '@deepseek-ai/dsh-tool-web',
    ]) {
      expect(rows.get(name), name).toEqual({ enabled: true })
    }
  })

  it('mounts tool-ask-user host-plane and retires the preset roster', () => {
    const rows = rosterByName()
    // `tool-ask-user` has no base row (upstream ships it only through
    // presets); the open capability base mounts it here so the mounted
    // ui-user-questions face keeps its producer.
    expect(rows.get('@deepseek-ai/dsh-tool-ask-user')).toEqual({ enabled: true })
    // The preset roster stays disabled (ADR 0012 §4: presets are the upstream
    // compatibility layer): sessions compose the host plane, and a live row on
    // both planes would mount twice — a row belongs to exactly one plane.
    expect(rows.get('@deepseek-ai/dsh-agent-presets')).toEqual({ enabled: false })
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
      body: async (run: EngineStepCtx) => {
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
