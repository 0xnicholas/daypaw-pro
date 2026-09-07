/**
 * Executed approval-guardrail coverage for the open agent plane (ticket
 * #103): boots the daypaw surface's real bundle composition (dsh-base +
 * @daypaw/web-app) through the Loader under an isolated profile home, with
 * only the web-transport rows disabled, and proves the three facts ADR 0013
 * §3 rules — (1) a bare agent (the engine-run shape: its own setup, no preset
 * join, the seeded agents' `tools: []` declaration) inherits the full
 * model-side tool line from the host composition's global layer; (2) a
 * workspace-scoped command runs under the #46 conservative default without
 * asking; (3) a sandbox escalation — the sensitive-operation shape — travels
 * the exact seam the browser approval board answers through: the scoped
 * `approval/request` waterfall (what `api-remotes` bridges to the gateway),
 * with the turn-enclosed `approval/asked` + `approval/decided` audit pair the
 * inbox 等待你确认 feed and the approval-history projection fold. The ask
 * stays open until answered (the waiting state), and a rejection fails the
 * call closed with nothing executed.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot, healProfilesModuleFallback, initProfile, loadOverlayPatches, loadProfile,
} from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
// Type-only: pulls the approval waterfall's Events declaration into this
// program so the answerer registration below is checked against the real
// listener signature (the `ApprovalRequestEvent` payload type arrives with it).
import type {} from '@deepseek-ai/dsh-user-approval'

/** The repo's dsh app manifest: the anchor the isolated profile's bundles resolve from. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../../../apps/cli/package.json', import.meta.url))

/** The daypaw profile's bundle layers, in order (what the CLI seeds). */
const BUNDLES = ['@deepseek-ai/dsh-base', '@daypaw/web-app'] as const

/**
 * Web-transport rows the composition cannot activate without a bound server
 * (they wait on webStartup/webServer/connection services). Everything on the
 * agent plane — the tool line, the sandbox and approval stack, the session
 * log — stays composed; `api-remotes` comes out too so this spec's answerer
 * occupies the scoped-waterfall seam itself instead of the gateway bridge.
 */
const WEB_TRANSPORT_OFF = `- id: session-log-download
  disabled: true
- id: directory-picker
  disabled: true
- id: session-controller
  disabled: true
- id: web-startup
  disabled: true
- id: webserver
  disabled: true
- id: web-runtime
  disabled: true
- id: client-hmr
  disabled: true
- id: modules
  disabled: true
- id: connection
  disabled: true
- id: file-upload
  disabled: true
- id: api-remotes
  disabled: true
`

let home: string | undefined
let workspace: string | undefined
let ctx: Context | undefined
const handles: AgentHandle[] = []

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'daypaw-agent-plane-home-'))
  workspace = mkdtempSync(join(tmpdir(), 'daypaw-agent-plane-ws-'))
  const dir = join(home, 'profiles', 'daypaw')
  initProfile(dir, [...BUNDLES])
  const profile = loadProfile('daypaw-agent-plane', 'daypaw', INSTALL_ANCHOR, home, { userLayer: false })
  const rootConfig = join(profile.dir, 'cordis.yml')
  writeFileSync(rootConfig, '[]\n')
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile, home })
  const overlayFile = join(home, 'web-transport-off.patch.yml')
  writeFileSync(overlayFile, WEB_TRANSPORT_OFF)
  const patches = [
    ...profile.layers.flatMap(layer => layer.patches),
    ...loadOverlayPatches('daypaw-agent-plane', overlayFile),
  ]
  ctx = await boot('daypaw-agent-plane', rootConfig, patches)
}, 180_000)

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.dispose()
})

afterAll(async () => {
  await ctx?.fiber.dispose()
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true })
  home = undefined
  workspace = undefined
  ctx = undefined
})

/** Create one bare agent — the engine-run shape: own setup, no preset join. */
async function bareAgent(name: string): Promise<Agent> {
  const handle = await ctx!.agents.create({
    sessionId: SessionId(`agent-plane-${name}-${Date.now()}`),
    ...(workspace === undefined ? {} : { meta: { cwd: workspace } }),
    setup: () => {},
  })
  handles.push(handle)
  return handle.agent
}

/** Dispatch one model-shaped bash call on an agent, inside an open turn. */
async function dispatchBash(
  agent: Agent,
  args: Record<string, unknown>,
): Promise<{ isError: boolean | undefined; text: string }> {
  agent.session.append('turn/start', { turn: 1 })
  try {
    const result = await ctx!.tools.execute({
      callId: ToolCallId(`agent-plane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      name: 'bash',
      arguments: args,
      agent,
      signal: AbortSignal.timeout(60_000),
    })
    return {
      isError: result.isError,
      text: result.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join(''),
    }
  } finally {
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  }
}

/** The agent's session events of one approval kind, in log order. */
function approvalEvents(agent: Agent, type: 'approval/asked' | 'approval/decided'): SessionEvent[] {
  return agent.session.snapshotEvents().filter(event => event.type === type)
}

/** Asked-audit payloads of one agent, in log order. */
function askedOf(agent: Agent): Array<{ id: string; toolName: string }> {
  return (approvalEvents(agent, 'approval/asked') as Array<{ data: { id: string; toolName: string } }>)
    .map(event => ({ id: event.data.id, toolName: event.data.toolName }))
}

/** Outcome payload of a decided event, for closed-vocabulary assertions. */
function outcomes(agent: Agent): Array<{ id: string; outcome: string }> {
  return (approvalEvents(agent, 'approval/decided') as Array<{ data: { id: string; outcome: string } }>)
    .map(event => ({ id: event.data.id, outcome: event.data.outcome }))
}

interface AskRecord { toolName: string; reason: string; signalAborted: boolean }

/**
 * Register the spec's answerer at the scoped-waterfall seam — the
 * registration `api-remotes` holds in the full composition — first in line.
 * @param answer - produce the outcome (or a promise of it) for each ask.
 * @returns the ask records and the disposer.
 */
function answerer(
  answer: (ask: AskRecord) => ApprovalOutcome | PromiseLike<ApprovalOutcome>,
): { asks: AskRecord[]; dispose: () => void } {
  const asks: AskRecord[] = []
  const listener = async (request: ApprovalRequestEvent): Promise<ApprovalOutcome> => {
    const ask: AskRecord = {
      toolName: request.toolName,
      reason: request.reason ?? '',
      signalAborted: request.signal?.aborted === true,
    }
    asks.push(ask)
    return answer(ask)
  }
  const dispose = ctx!.on('approval/request', listener, { prepend: true })
  return { asks, dispose }
}

// The spec drives the POSIX shell stack the base composes on this platform;
// win32 swaps `bash` for `pwsh` (base rows gate on platform), so its catalog
// and shell probes would need a pwsh mirror — out of scope here.
const onPosix = process.platform === 'win32' ? describe.skip : describe

onPosix('the open agent plane under the conservative approval default (ticket #103)', () => {
  it('gives a bare agent — the engine-run shape — the full model-side tool line', async () => {
    const agent = await bareAgent('catalog')
    const names = ctx!.tools.schemas(scopeOf(agent.ctx)).map(schema => schema.name).sort()
    expect(names).toEqual([
      'ask_user_question', 'bash', 'create_goal', 'edit', 'exit_plan_mode', 'get_goal',
      'glob', 'grep', 'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents',
      'ralph', 'read', 'read_image', 'send_message', 'skill', 'str_replace_editor',
      'subagent', 'subagent_fork', 'todo_write', 'update_goal', 'web_fetch', 'web_search',
      'workflow', 'write',
    ])
  }, 60_000)

  it('runs a workspace-scoped command without asking (the conservative default admits in-workspace writes)', async () => {
    const agent = await bareAgent('workspace-write')
    const marker = join(workspace!, 'marker.txt')
    const result = await dispatchBash(agent, {
      command: `printf daypaw > ${JSON.stringify(marker)}`,
      description: 'write inside the workspace',
    })
    expect(result.isError).not.toBe(true)
    expect(approvalEvents(agent, 'approval/asked')).toHaveLength(0)
  }, 60_000)

  it('routes a sandbox escalation through the approval ask and runs it once approved', async () => {
    const agent = await bareAgent('escalate-approve')
    const outside = join(workspace!, '..', 'agent-plane-escalated.txt')
    const { asks, dispose } = answerer(() => 'allowed-once')
    try {
      const result = await dispatchBash(agent, {
        command: `touch ${JSON.stringify(outside)}`,
        description: 'write outside the workspace',
        sandbox_permissions: 'danger-full-access',
        justification: 'the probe must write outside the workspace',
      })
      // The ask traveled the scoped waterfall with the audit reason.
      expect(asks).toEqual([{
        toolName: 'bash',
        reason: 'escalate sandbox to danger-full-access: the probe must write outside the workspace',
        signalAborted: false,
      }])
      // Approved: the escalated command ran and the audit pair landed.
      expect(result.isError).not.toBe(true)
      const [asked] = askedOf(agent)
      expect(asked?.toolName).toBe('bash')
      expect(typeof asked?.id).toBe('string')
      expect(outcomes(agent)).toEqual([{ id: asked!.id, outcome: 'allowed-once' }])
    } finally {
      dispose()
    }
  }, 60_000)

  it('keeps the ask open — the waiting state — until the answerer answers', async () => {
    const agent = await bareAgent('escalate-waiting')
    const outside = join(workspace!, '..', 'agent-plane-waiting.txt')
    let release!: (outcome: ApprovalOutcome) => void
    const gated = new Promise<ApprovalOutcome>((resolve) => { release = resolve })
    const { dispose } = answerer(() => gated)
    try {
      agent.session.append('turn/start', { turn: 1 })
      const pending = ctx!.tools.execute({
        callId: ToolCallId(`agent-plane-waiting-${Date.now()}`),
        name: 'bash',
        arguments: {
          command: `touch ${JSON.stringify(outside)}`,
          description: 'write outside the workspace',
          sandbox_permissions: 'danger-full-access',
          justification: 'waiting-state probe',
        },
        agent,
        signal: AbortSignal.timeout(60_000),
      })
      // The asked audit is already durable while the call waits on the answer.
      await vi.waitFor(() => {
        expect(approvalEvents(agent, 'approval/asked')).toHaveLength(1)
      })
      expect(approvalEvents(agent, 'approval/decided')).toHaveLength(0)
      release('allowed-once')
      const settled = await pending
      expect(settled.isError).not.toBe(true)
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const [asked] = askedOf(agent)
      expect(asked).toBeDefined()
      expect(outcomes(agent)).toEqual([{ id: asked!.id, outcome: 'allowed-once' }])
    } finally {
      dispose()
    }
  }, 60_000)

  it('fails a rejected escalation closed, with nothing executed', async () => {
    const agent = await bareAgent('escalate-reject')
    const outside = join(workspace!, '..', 'agent-plane-rejected.txt')
    const { dispose } = answerer(() => 'rejected')
    try {
      const result = await dispatchBash(agent, {
        command: `touch ${JSON.stringify(outside)}`,
        description: 'write outside the workspace',
        sandbox_permissions: 'danger-full-access',
        justification: 'rejection probe',
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('the user rejected escalating this command to "danger-full-access"')
      const [asked] = askedOf(agent)
      expect(asked).toBeDefined()
      expect(outcomes(agent)).toEqual([{ id: asked!.id, outcome: 'rejected' }])
    } finally {
      dispose()
    }
  }, 60_000)
})
