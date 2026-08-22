/**
 * Agent-compilation demo (ADR 0010 §4): a durable workflow whose single step
 * runs a `defineAgent`-compiled durable agent through `ctx.agent` over the
 * real dsh agent stack. The LLM route is served keylessly from a scripted
 * replay override (`--override`), so the demo runs without an API key; the
 * snapshot suite diffs the persisted session log — the model-visible surface
 * (prompt section, `submit` schema, input message, and after a kill the
 * synthetic resume steer).
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { installLlmReplay } from '@deepseek-ai/dsh-llm-replay'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DurableEngine from '@daypaw/engine'
import { bind, bindAgent, defineAgent, defineWorkflow } from '@daypaw/sdk'
import { z } from 'zod'

function argOf(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const at = argv.indexOf(`--${name}`)
  return at >= 0 ? argv[at + 1] : undefined
}

const dbPath = argOf('db')
const sessionsRoot = argOf('sessions')
const overridePath = argOf('override')
const runId = argOf('run-id') ?? 'agent-demo-1'
if (dbPath === undefined || sessionsRoot === undefined || overridePath === undefined) {
  console.error('usage: agent-main.ts --db <ledger.db> --sessions <dir> --override <replay.override.json> [--run-id <id>] [--hold-open]')
  process.exit(2)
}
// Long-lived-host posture: a ref'd heartbeat keeps the event loop alive while
// a run is mid-flight (a server host always has live handles), so the
// snapshot's SIGKILL models the host dying mid-turn rather than the loop
// draining out from under the driver. Cleared on clean completion.
const keepAlive = process.argv.includes('--hold-open') ? setInterval(() => {}, 60_000) : undefined

const reviewer = defineAgent({
  name: 'reviewer',
  version: '1',
  input: z.object({ code: z.string() }),
  output: z.object({ score: z.number() }),
  prompt: [{ name: 'reviewer-persona', order: 10, text: 'You review code and report a numeric score from 0 to 100.' }],
  tools: [],
  model: { provider: 'replay', model: 'replay-1', maxTokens: 4096 },
  maxTurns: 4,
})

const reviewFlow = defineWorkflow({
  name: 'review-flow',
  version: '1',
  input: z.object({ code: z.string() }),
  output: z.object({ verdict: z.number() }),
  body: async (ctx, input) => {
    const reviewed = await ctx.agent(reviewer, { code: input.code })
    return { verdict: reviewed.score }
  },
})

const ctx = new Context()
await ctx.plugin(DurableEngine, { path: dbPath, pollMs: 50 })
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop)
await ctx.plugin(JsonlSessionPersistence, { root: sessionsRoot })
// Override-only replay: `file` points at a deliberately absent primary session
// log, so the sidecar fully supplies the script and the missing header falls
// back to the primary-ordering default (llm-replay's override-only contract).
const replay = installLlmReplay(ctx, { file: `${overridePath}.session.jsonl`, overrideFile: overridePath })
try {
  await bindAgent(reviewer, ctx)
  const workflow = await bind(reviewFlow, ctx.durable)
  const handle = await workflow.run({ code: 'export const answer = 42' }, { runId })
  console.log(JSON.stringify(await handle.result))
  replay.assertConsumed()
} finally {
  if (keepAlive !== undefined) clearInterval(keepAlive)
  replay.dispose()
  await ctx.fiber.dispose()
}
