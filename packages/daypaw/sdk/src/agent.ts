/**
 * The `defineAgent` face of `@daypaw/sdk` (ADR 0010): a declarative agent
 * definition (name+version, zod IO, static composition lines) compiled by
 * {@link bindAgent} into an opaque engine body. The engine stays blind to
 * `kind: 'agent'`; the compiled closure owns the whole LLM world — dsh agent
 * creation/resumption, model routing, prompt sections, tools, and the
 * `submit` termination convention.
 * @module @daypaw/sdk/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { ZodType } from 'zod'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { DefinitionDisplay, EngineDefinition, EngineStepCtx } from '@daypaw/engine'
import type { RunHandle, RunOptions } from './run-handle.ts'
import { startRun } from './run-handle.ts'

/** zod schema → inferred TS type. */
type Infer<I extends ZodType> = z.output<I>

/** One static system-prompt segment of an agent composition. */
export interface PromptSegment {
  /** Section name; must be unique within the agent's scoped prompt registry. */
  readonly name: string
  /** Assembly order (ascending), on the dsh system-prompt scale. */
  readonly order: number
  /** Static section text; may reference `{{variable}}`s. */
  readonly text: string
}

/** Static model routing of an agent composition. */
export interface ModelRoute {
  /** Provider route name registered with `ctx.llm`. */
  readonly provider: string
  /** Model name within the provider. */
  readonly model: string
  /** Per-request output-token ceiling. */
  readonly maxTokens?: number
}

/** Options declaring one agent definition. */
export interface DefineAgentOptions<I extends ZodType, O extends ZodType> {
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Input contract; the run input becomes the first user message (JSON text). */
  readonly input: I
  /** Output contract; also the `submit` tool's argument schema. */
  readonly output: O
  /** Static system-prompt segments registered in the agent's scope. */
  readonly prompt: readonly PromptSegment[]
  /** Tool surface: dsh `ToolDefinition`s accepted as-is, zero adapter. */
  readonly tools: readonly ToolDefinition[]
  /** Static model routing. */
  readonly model: ModelRoute
  /**
   * Turn budget across the whole run (a resumed run's history counts). One
   * wake runs exactly one turn to quiescence, so the compiled body checks the
   * budget before waking: a run whose history already holds this many turns
   * fails instead of starting another. dsh has no turn cap of its own.
   */
  readonly maxTurns: number
  /**
   * Steer channel opt-in (issue #53): a run of this definition stays open
   * after a submit-less turn — parked at zero compute — and consumes
   * follow-up inputs (`RunHandle.steer`) as further user messages at segment
   * boundaries, under the same runId. Undeclared keeps the single-segment
   * contract: a turn that ends without `submit` fails the run.
   */
  readonly steerable?: boolean
  /**
   * Display metadata for host catalog views (spec 05 §5): the business-facing
   * name and description, validated non-blank at declaration. Metadata only —
   * the engine never reads it for execution. Undeclared: the registry read
   * view omits the `display` key and the presenter falls back to the
   * technical `name`.
   */
  readonly display?: DefinitionDisplay
}

/** A declared (not yet bound) agent definition. */
export interface AgentDefinition<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /** Definition family discriminator. */
  readonly kind: 'agent'
  /** Definition name. */
  readonly name: string
  /** Definition version. */
  readonly version: string
  /** Input contract. */
  readonly input: I
  /** Output contract. */
  readonly output: O
  /** Static system-prompt segments. */
  readonly prompt: readonly PromptSegment[]
  /** Tool surface. */
  readonly tools: readonly ToolDefinition[]
  /** Static model routing. */
  readonly model: ModelRoute
  /** Turn budget. */
  readonly maxTurns: number
  /** Steer channel opt-in; undefined means single-segment. */
  readonly steerable?: boolean
  /** Display metadata for host catalog views; undefined when undeclared. */
  readonly display?: DefinitionDisplay
}

/**
 * Declare an agent definition.
 * @param options - identity, contracts, and static composition lines.
 * @returns the unbound definition; pass to {@link bindAgent}.
 */
export function defineAgent<I extends ZodType, O extends ZodType>(
  options: DefineAgentOptions<I, O>,
): AgentDefinition<I, O> {
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1) {
    throw new Error(`defineAgent(${options.name}): maxTurns must be a positive integer`)
  }
  if (options.display !== undefined && (!options.display.title.trim() || !options.display.description.trim())) {
    throw new Error(`defineAgent(${options.name}): display.title and display.description must be non-blank`)
  }
  return { kind: 'agent', ...options }
}

/** The bound, runnable face of one agent definition on one host composition. */
export interface BoundAgent<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /**
   * Start a run (input validated against the definition's contract), or
   * attach to an existing runId. Inside a workflow step the runId derives
   * deterministically from the ambient step scope (spec 02 §2).
   * @param input - agent input; becomes the first user message.
   * @param opts - run identity, cancellation, and metadata.
   * @returns the typed run handle.
   */
  run(input: Infer<I>, opts?: RunOptions): Promise<RunHandle<Infer<O>, Infer<I>>>
}

/**
 * Model-visible wake text steered into a resumed agent (ADR 0010 §3: dsh has
 * no contentless wake). The restart is a real event, so the message says so.
 */
const RESUME_MESSAGE =
  'The host process restarted and recovered this session from durable storage. ' +
  'Continue the current task from the context above and call submit when the final result is ready.'

/** Mutable capture cell the injected `submit` tool writes its validated value into. */
interface SubmitCapture {
  set: boolean
  value: unknown
}

/**
 * Build the SDK-injected termination tool (ADR 0010 §2): argument schema =
 * the definition's output schema (object-rooted schemas apply directly;
 * anything else wraps under a single `value` parameter). The handler captures
 * and validates the value; the model reads the tool result and closes its
 * turn naturally.
 */
function buildSubmitTool(def: AgentDefinition, capture: SubmitCapture): ToolDefinition {
  const outputJsonSchema = z.toJSONSchema(def.output)
  const objectRooted = outputJsonSchema.type === 'object'
  const parameters: Record<string, unknown> = objectRooted
    ? outputJsonSchema
    : { type: 'object', properties: { value: outputJsonSchema }, required: ['value'], additionalProperties: false }
  const acceptedSchema: JsonSchemaNode = {
    type: 'object',
    properties: { accepted: { type: 'boolean' } },
    required: ['accepted'],
  }
  return {
    name: 'submit',
    description:
      'Submit the final result of the task. Call exactly once, when the task is complete; ' +
      'the arguments must satisfy the required output schema.',
    parameters,
    output: {
      schema: acceptedSchema,
      render: () => [{ type: 'text', text: 'Submission accepted; the run is complete.' }],
    },
    execute: (args: unknown) => {
      if (capture.set) throw new Error('submit was already called in this run')
      const value = def.output.parse(objectRooted ? args : (args as { value: unknown }).value)
      capture.set = true
      capture.value = value
      return Promise.resolve({ accepted: true })
    },
  }
}

/** Compose the agent's scoped world at create/resume time (composition only, never driving). */
function setupFor(def: AgentDefinition, capture: SubmitCapture): AgentSetup {
  return (agentCtx) => {
    installModelSelection(agentCtx, {
      current: { provider: def.model.provider, model: def.model.model },
      assembled: undefined,
    })
    for (const segment of def.prompt) {
      const section: PromptSection = { name: segment.name, order: segment.order, text: segment.text }
      agentCtx.systemPrompt.section(section)
    }
    for (const tool of def.tools) agentCtx.tools.register(tool)
    agentCtx.tools.register(buildSubmitTool(def, capture))
  }
}

/**
 * Await whole-agent quiescence, racing driver cancellation. On abort the
 * agent is cancelled so it stops spending tokens, and the rejection lets the
 * engine finalize the run as cancelled.
 */
async function awaitQuiescence(agent: Agent, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error(`run ${agent.id} cancelled before driving`)
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      agent.cancel({ kind: 'user' })
      reject(new Error(`run ${agent.id} cancelled`))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([agent.whenIdle(), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Journal every closed dsh step in the session log as one journal step
 * (ADR 0010 §2). Keys derive from the durable `(turn, step)` pair, so a
 * re-driven body re-walks the resumed log and the engine's dedup returns the
 * recorded slices without re-executing; the model calls are saved by the
 * session resume itself.
 */
async function journalSteps(stepCtx: EngineStepCtx, session: Session): Promise<void> {
  const events: readonly SessionEvent[] = session.events
  let open: { turn: number; step: number; from: number } | undefined
  let index = 0
  for (const event of events) {
    if (event.type === 'step/start') {
      open = { turn: event.data.turn, step: event.data.step, from: index }
    } else if (event.type === 'step/end') {
      /* v8 ignore next 3 -- session logs are balanced: persistence validates and repairs on load, and quiescence closes every live step */
      if (open !== undefined) {
        const slice = events.slice(open.from, index + 1)
        const stepKey = `dsh-step:${open.turn}:${open.step}`
        await stepCtx.step(stepKey, () => Promise.resolve(JSON.parse(JSON.stringify(slice)) as unknown), { key: stepKey })
        open = undefined
      }
    }
    index += 1
  }
}

/** The reason the last completed turn ended, for failure diagnostics. */
function lastTurnEndKind(events: readonly SessionEvent[]): string {
  let kind = 'none'
  for (const event of events) {
    if (event.type === 'turn/end') kind = event.data.reason.kind
  }
  return kind
}

/** Count every turn the session has started, including a resumed history. */
function countTurns(events: readonly SessionEvent[]): number {
  let turns = 0
  for (const event of events) {
    if (event.type === 'turn/start') turns += 1
  }
  return turns
}

/** Text of a single-text-block user message; other content shapes never match the wake constants. */
function userMessageText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const [only] = event.data.content
  return event.data.content.length === 1 && only?.type === 'text' ? only.text : undefined
}

/**
 * Count steered segments already delivered into the durable log, for ordinal
 * dedup across re-drives: user messages are the initial input, RESUME wakes,
 * and steered segments in delivery order. Ordinal (not content) matching
 * keeps two identical follow-ups distinct.
 */
function countDeliveredSteers(events: readonly SessionEvent[]): number {
  let userInputs = 0
  for (const event of events) {
    const text = userMessageText(event)
    if (text !== undefined && text !== RESUME_MESSAGE) userInputs += 1
  }
  // The initial input is segment 0 and never a recorded steer segment.
  return Math.max(0, userInputs - 1)
}

/**
 * Whether the log's last started turn was crash-interrupted — never closed, or
 * closed by the persistence layer's synthetic `interrupted` marker (the repair
 * closer is durably appended on load, so "no turn/end" never survives a
 * revival). An interrupted turn needs the resume wake; any other end reason is
 * a clean quiescence the revival re-parks on.
 */
function lastTurnInterrupted(events: readonly SessionEvent[]): boolean {
  let open = false
  let interrupted = false
  for (const event of events) {
    if (event.type === 'turn/start') {
      open = true
      interrupted = false
    } else if (event.type === 'turn/end') {
      open = false
      interrupted = event.data.reason.kind === 'interrupted'
    }
  }
  return open || interrupted
}

/** Compiled opaque body: one run = one dsh session, sessionId ≡ runId (ADR 0010 §3). */
function compileBody(def: AgentDefinition, host: Context): EngineDefinition['body'] {
  const agents = host.get('agents')
  const sessions = host.get('sessions')
  const persistence: SessionPersistence | undefined = host.get('sessionPersistence')
  if (agents === undefined || sessions === undefined) {
    throw new Error('bindAgent requires the agents and sessions services (mount @deepseek-ai/dsh-agent, dsh-session, and an agent-loop provider)')
  }
  if (persistence === undefined) {
    throw new Error('bindAgent requires a session persistence backend (e.g. @deepseek-ai/dsh-session-persistence-jsonl): agent runs revive across processes through it')
  }
  const steerable = def.steerable === true
  return async (stepCtx, rawInput) => {
    const input = def.input.parse(rawInput)
    const sessionId = SessionId(stepCtx.runId)
    // First drive vs revival is decided by the persisted session, not the run
    // row: a crash between the run insert and agent creation must still take
    // the create path.
    const resumed = (await persistence.list()).some(header => header.id === sessionId)
    const capture: SubmitCapture = { set: false, value: undefined }
    const agentOptions: AgentOptions = {
      provider: def.model.provider,
      model: def.model.model,
      ...(def.model.maxTokens === undefined ? {} : { maxTokens: def.model.maxTokens }),
    }
    const handle: AgentHandle = resumed
      ? await agents.resume({ resumeSessionId: sessionId, agentOptions, setup: setupFor(def, capture) })
      : await agents.create({
        sessionId,
        agentOptions,
        meta: { cwd: process.cwd() },
        setup: setupFor(def, capture),
      })
    const agent = handle.agent
    const userText = (text: string) =>
      createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    try {
      // The turn budget is exact without live watching: one wake runs exactly
      // one turn to quiescence, so a revived run whose history already holds
      // `maxTurns` turns must fail instead of being steered into another.
      const wake = async (deliver: () => void): Promise<void> => {
        if (countTurns(agent.session.events) >= def.maxTurns) {
          throw new Error(`agent run ${stepCtx.runId} exceeded maxTurns (${def.maxTurns}) without calling submit`)
        }
        deliver()
        await awaitQuiescence(agent, stepCtx.signal)
        await journalSteps(stepCtx, agent.session)
      }
      // Steered segments already in the durable log count as delivered; a
      // re-drive must not re-steer them (model-visible ⟺ logged: the log is
      // the replay source for the conversation flow).
      let delivered = countDeliveredSteers(agent.session.events)
      if (!resumed) {
        await wake(() =>{  agent.followup(userText(JSON.stringify(input))) })
      } else if (steerable && delivered < stepCtx.steers().length) {
        // Segments recorded while no process drove the run are the wake; the
        // loop below delivers them in record order.
      } else if (!steerable || lastTurnInterrupted(agent.session.events)) {
        // Continue a crash-interrupted turn. A steerable run parked at a
        // segment boundary quiesced cleanly, so its revival re-parks instead
        // of spending a turn on the synthetic message.
        await wake(() =>{  agent.steer(userText(RESUME_MESSAGE)) })
      }
      for (;;) {
        if (capture.set) {
          await sessions.flush(agent.session)
          return def.output.parse(capture.value)
        }
        if (!steerable) {
          throw new Error(`agent run ${stepCtx.runId} ended (last turn: ${lastTurnEndKind(agent.session.events)}) without calling submit`)
        }
        const segments = stepCtx.steers()
        if (delivered < segments.length) {
          // Cross-writer defense: a segment recorded through the bare engine
          // face carries no zod validation, so the consumption side re-checks
          // the input contract before the text reaches the model.
          const text = JSON.stringify(def.input.parse(segments[delivered]))
          await wake(() =>{  agent.steer(userText(text)) })
          delivered += 1
          continue
        }
        // Park at zero compute until the next segment, cancellation, or
        // disposal; a dead process revives through the boot scan.
        await stepCtx.awaitSteer(delivered)
      }
    } finally {
      await handle.dispose()
    }
  }
}

/** Bound faces per definition object; doubles as the `ctx.agent` lookup registry. */
const boundAgents = new WeakMap<AgentDefinition, BoundAgent>()

/**
 * @param def - declared agent definition.
 * @returns the bound face when {@link bindAgent} has bound the definition,
 * `undefined` otherwise (`ctx.agent` fails loud on the undefined branch).
 */
export function boundAgentFor(def: AgentDefinition): BoundAgent | undefined {
  return boundAgents.get(def)
}

/**
 * Bind an agent definition to a host composition: compiles it into an opaque
 * engine body (the engine stays agent-blind), registers it on `ctx.durable`
 * for execution and boot-time revival, and returns the runnable face.
 * Binding the same definition object again is a no-op returning the first
 * face — the closure captures the first host context, exactly like `bind`.
 * @param def - definition from {@link defineAgent}.
 * @param ctx - host Cordis context with the dsh agent stack (agents,
 * sessions, session persistence) and `ctx.durable` mounted.
 * @returns the bound agent.
 */
export async function bindAgent<I extends ZodType, O extends ZodType>(
  def: AgentDefinition<I, O>,
  ctx: Context,
): Promise<BoundAgent<I, O>> {
  const existing = boundAgents.get(def)
  if (existing !== undefined) return existing
  const engine = ctx.get('durable')
  if (engine === undefined) {
    throw new Error('bindAgent requires the durable engine service (mount @daypaw/engine)')
  }
  const engineDef: EngineDefinition = {
    kind: 'agent',
    name: def.name,
    version: def.version,
    ...(def.display === undefined ? {} : { display: def.display }),
    ...(def.steerable === true ? { steerable: true } : {}),
    body: compileBody(def, ctx),
  }
  await engine.register(engineDef)
  const bound: BoundAgent<I, O> = {
    run: (input, opts) => startRun(engine, engineDef, def, input, opts),
  }
  boundAgents.set(def, bound)
  return bound
}
