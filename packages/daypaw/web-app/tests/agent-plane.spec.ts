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
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot, composeEntries, createRuntimeResolution, initProfile, loadOverlayPatches, loadProfile, PluginPackages,
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

/** The repo root the browser-half manifest scan reads from. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** The daypaw profile's bundle layers, in order (what the CLI seeds). */
const BUNDLES = ['@deepseek-ai/dsh-base', '@daypaw/web-app'] as const

/** The composed-roster fields the derivation reads. */
interface RosterRow {
  id: string
  name: string
}

/**
 * The web transport itself, disabled headless. These rows mount host-only
 * packages (no browser half to key the derivation off), and without them the
 * composition would either bind a real server or wait forever on services
 * (`webStartup`, `webRuntime`) only a web invocation provides.
 */
const HOST_TRANSPORT_OFF = [
  // Samples the display and bind host from webRuntime to choose the
  // dual-face picker's backend.
  'directory-picker',
  // Parses the web invocation's flags and provides `webStartup`.
  'web-startup',
  // Binds the HTTP server the transport serves through.
  'webserver',
  // Resolves the frontend dist and provides `webRuntime`.
  'web-runtime',
] as const

/**
 * Browser-half rows the headless composition keeps live anyway: their node
 * halves provide services host rows consume, so disabling them would stall a
 * host row's activation instead of pruning a browser face.
 */
const HOST_PLANE_KEEP = [
  // dsh-typert-registry's node half is the in-process type-graph registry;
  // typert-loader (a host row, no browser half) waits on its `typert` service.
  'typert',
] as const

/** Package name of a plugin specifier: subpaths collapse (`@scope/pkg/sub` → `@scope/pkg`). */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!
}

/**
 * Packages whose workspace manifest declares a browser half (`dsh.client`) —
 * the same fact the roster mirror gate keys on: a composed row mounting one
 * of these rides the web plane.
 * @param repoRoot - repository root to scan workspace package manifests
 * (`packages/<group>/<pkg>/package.json`) under.
 * @returns the browser-half package names.
 */
function clientPluginPackages(repoRoot: string): Set<string> {
  const names = new Set<string>()
  for (const manifestPath of globSync('packages/*/*/package.json', { cwd: repoRoot })) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8')) as {
      name?: string
      dsh?: { client?: unknown }
    }
    if (manifest.name !== undefined && manifest.dsh?.client !== undefined) names.add(manifest.name)
  }
  return names
}

/**
 * Derive the web-transport-off overlay content: every composed roster row
 * whose package declares a browser half is a web-plane row (its node half
 * waits on the bound server's services or serves only browser faces), plus
 * the host-transport remainder, minus the host-plane keeps. Everything on
 * the agent plane — the tool line, the sandbox and approval stack, the
 * session log — stays composed; `api-remotes` comes out too so this spec's
 * answerer occupies the scoped-waterfall seam itself instead of the gateway
 * bridge. Deriving from the roster means upstream growing the browser roster
 * (a new `dsh.client` row the mirror gate forces into the fork patch) flows
 * through with no edit here — the 2026-09-13 sync had to chase the
 * ui-deliverables row into the old 12-line literal.
 * @param roster - the booted profile's composed entry list.
 * @param clientPackages - browser-half package names.
 * @returns the overlay file body: one `- id: …` / `disabled: true` pair per row.
 */
function webTransportOffOverlay(roster: readonly RosterRow[], clientPackages: ReadonlySet<string>): string {
  const off = new Set<string>(HOST_TRANSPORT_OFF)
  for (const entry of roster) {
    if (clientPackages.has(packageNameOf(entry.name))) off.add(entry.id)
  }
  for (const keep of HOST_PLANE_KEEP) off.delete(keep)
  return [...off].map(id => `- id: ${id}\n  disabled: true\n`).join('')
}

let home: string | undefined
let workspace: string | undefined
let ctx: Context | undefined
let rosterRows: readonly RosterRow[] | undefined
const handles: AgentHandle[] = []

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'daypaw-agent-plane-home-'))
  workspace = mkdtempSync(join(tmpdir(), 'daypaw-agent-plane-ws-'))
  const dir = join(home, 'profiles', 'daypaw')
  initProfile(dir, [...BUNDLES])
  const profile = loadProfile('daypaw-agent-plane', 'daypaw', INSTALL_ANCHOR, home, { userLayer: false })
  const rootConfig = join(profile.dir, 'cordis.yml')
  writeFileSync(rootConfig, '[]\n')
  const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile })
  rosterRows = composeEntries(profile.layers.map(layer => layer.patches))
  const overlayFile = join(home, 'web-transport-off.patch.yml')
  writeFileSync(overlayFile, webTransportOffOverlay(rosterRows, clientPluginPackages(REPO_ROOT)))
  const patches = [
    ...profile.layers.flatMap(layer => layer.patches),
    ...loadOverlayPatches('daypaw-agent-plane', overlayFile),
  ]
  ctx = await boot('daypaw-agent-plane', rootConfig, patches, async (rootCtx) => {
    // The runtime resolution replaces the healed profiles/node_modules links:
    // PluginPackages supplies the installation generation to Node's resolvers
    // before any config-tree entry imports.
    await rootCtx.plugin(PluginPackages, { resolution })
  })
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

/** Register the spec's answerer at the scoped-waterfall seam — the
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

describe('the web-transport-off overlay is derived from the roster (ticket #122)', () => {
  it('absorbs an upstream-grown browser row with no edit to this spec', () => {
    // The sync event the derivation replaces: upstream ships a new client
    // package (its workspace manifest declares the browser half) and the
    // roster mirror gate adds the row to the fork patch. Both inputs grow;
    // the overlay picks the row up with nothing here restating ids.
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'daypaw-agent-plane-roster-'))
    try {
      const shinyDir = join(fixtureRoot, 'packages/client/ui-shiny')
      mkdirSync(shinyDir, { recursive: true })
      writeFileSync(join(shinyDir, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh-client-ui-shiny',
        dsh: { client: {} },
      }))
      const grown = [...rosterRows!, { id: 'ui-shiny', name: '@deepseek-ai/dsh-client-ui-shiny' }]
      const clientPackages = new Set([...clientPluginPackages(REPO_ROOT), ...clientPluginPackages(fixtureRoot)])
      expect(webTransportOffOverlay(grown, clientPackages)).toContain('- id: ui-shiny\n  disabled: true\n')
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('keeps every literal edge id a row the composition actually mounts', () => {
    // A stale literal (a sync renaming a remainder or keep row) would target
    // nothing and silently stop guarding; fail loud instead.
    const mounted = new Set(rosterRows!.map(row => row.id))
    for (const id of [...HOST_TRANSPORT_OFF, ...HOST_PLANE_KEEP]) {
      expect(mounted.has(id), id).toBe(true)
    }
  })
})

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
      'read', 'read_image', 'send_message', 'skill', 'str_replace_editor',
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
