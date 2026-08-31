import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import DurableEngine from '@daypaw/engine'
import type { DefinitionDisplay } from '@daypaw/engine'
import { bind, bindAgent, defineAgent, defineWorkflow, RunCancelledError, RunFailedError } from '@daypaw/sdk'
import type { AgentDefinition, BoundAgent, WorkflowCtx } from '@daypaw/sdk'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** One MockAdapter script entry. */
type ScriptEntry = StreamChunk[] | 'hang'

interface Composition {
  ctx: Context
  adapter: MockAdapter
  ledgerPath: string
  sessionsRoot: string
}

let root: string | undefined
let contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts = []
  if (root !== undefined) {
    // Session write-behind and SQLite WAL sidecars can linger one tick past
    // close; retry the cleanup.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 2) throw error
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
  }
  root = undefined
})

/** The reviewer definition reused across tests; maxTurns fits one wake plus one resume wake. */
function reviewerDef(maxTurns = 4, steerable = false): AgentDefinition<
  z.ZodObject<{ code: z.ZodString }>,
  z.ZodObject<{ answer: z.ZodNumber }>
> {
  return defineAgent({
    name: 'reviewer',
    version: '1',
    input: z.object({ code: z.string() }),
    output: z.object({ answer: z.number() }),
    prompt: [{ name: 'reviewer-persona', order: 10, text: 'You review code and report a numeric score.' }],
    tools: [],
    model: { provider: 'mock', model: 'mock', maxTokens: 4096 },
    maxTurns,
    ...steerable ? { steerable } : {},
  })
}

/** All model-visible user text a composition's adapter was asked about. */
function userTexts(adapter: MockAdapter): string[] {
  return adapter.requests
    .flatMap(request => request.messages)
    .filter(message => message.role === 'user')
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
}

/**
 * Boot the real Loader composition for agent runs: the daypaw engine over a
 * temp ledger plus the dsh agent stack with a JSONL persistence backend, and
 * a scripted MockAdapter on the `mock` provider route.
 */
async function loadComposition(script: ScriptEntry[], paths?: { ledgerPath: string; sessionsRoot: string }): Promise<Composition> {
  root ??= await mkdtemp(join(tmpdir(), 'daypaw-sdk-agent-'))
  const ledgerPath = paths?.ledgerPath ?? join(root, `ledger-${contexts.length}.db`)
  const sessionsRoot = paths?.sessionsRoot ?? join(root, 'sessions')
  const configPath = join(root, `cordis-${contexts.length}.yml`)
  await writeFile(configPath, [
    '- name: \'@daypaw/engine\'',
    '  config:',
    `    path: ${JSON.stringify(ledgerPath)}`,
    '- name: \'@deepseek-ai/dsh-llm\'',
    '- name: \'@deepseek-ai/dsh-session\'',
    '- name: \'@deepseek-ai/dsh-system-prompt\'',
    '- name: \'@deepseek-ai/dsh-tools\'',
    '- name: \'@deepseek-ai/dsh-agent\'',
    '- name: \'@deepseek-ai/dsh-agent-loop\'',
    '- name: \'@deepseek-ai/dsh-session-persistence-jsonl\'',
    '  config:',
    `    root: ${JSON.stringify(sessionsRoot)}`,
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@daypaw/engine', DurableEngine],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter, ledgerPath, sessionsRoot }
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition timeout')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function readRuns(path: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM runs').all()
  } finally {
    db.close()
  }
}

function readJournal(path: string, runId: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM journal WHERE run_id = ? ORDER BY rowid').all(runId)
  } finally {
    db.close()
  }
}

describe('bindAgent over a real dsh composition', () => {
  // Loader composition pays a one-time resolution cost per boot.
  const timeout = 60_000

  it('flows types through defineAgent and bindAgent', () => {
    const def = reviewerDef()
    expectTypeOf(def.kind).toEqualTypeOf<'agent'>()
    expectTypeOf(def.display).toEqualTypeOf<DefinitionDisplay | undefined>()
    type Bound = Awaited<ReturnType<typeof bindAgent<typeof def.input, typeof def.output>>>
    expectTypeOf<Bound>().toEqualTypeOf<BoundAgent<typeof def.input, typeof def.output>>()
  })

  it('rejects a non-positive maxTurns at declaration', () => {
    expect(() => defineAgent({
      name: 'bad',
      version: '1',
      input: z.object({}),
      output: z.object({}),
      prompt: [],
      tools: [],
      model: { provider: 'mock', model: 'mock' },
      maxTurns: 0,
    })).toThrow(/maxTurns must be a positive integer/)
  })

  it('rejects blank display metadata at declaration', () => {
    const base = {
      name: 'bad-display',
      version: '1',
      input: z.object({}),
      output: z.object({}),
      prompt: [],
      tools: [],
      model: { provider: 'mock', model: 'mock' },
      maxTurns: 1,
    }
    expect(() => defineAgent({ ...base, display: { title: '', description: 'x' } }))
      .toThrow(/display\.title and display\.description must be non-blank/)
    expect(() => defineAgent({ ...base, display: { title: 'x', description: '  ' } }))
      .toThrow(/display\.title and display\.description must be non-blank/)
  })

  it('drives create → submit → done, journaling every dsh step', { timeout }, async () => {
    const { ctx, adapter, ledgerPath } = await loadComposition([
      toolCallResponse('c1', 'submit', { answer: 42 }),
      textResponse('all done'),
    ])
    const def = reviewerDef()
    const bound = await bindAgent(def, ctx)
    // Re-binding the same definition object is a no-op returning the first face.
    await expect(bindAgent(def, ctx)).resolves.toBe(bound)
    const handle = await bound.run({ code: 'return 1' }, { runId: 'agent-happy-1' })
    await expect(handle.result).resolves.toEqual({ answer: 42 })
    expect(adapter.requests).toHaveLength(2)

    const [row] = readRuns(ledgerPath)
    expect(row?.run_id).toBe('agent-happy-1')
    expect(row?.def_kind).toBe('agent')
    expect(row?.status).toBe('done')
    expect(JSON.parse(row?.output_json as string)).toEqual({ answer: 42 })

    // One dsh step = one journal step: the submit-call step and the closing text step.
    const journal = readJournal(ledgerPath, 'agent-happy-1')
    expect(journal.map(step => step.step_key)).toEqual(['dsh-step:1:1', 'dsh-step:1:2'])
    expect(journal.every(step => step.status === 'completed')).toBe(true)
    expect(JSON.parse(journal[0]?.value_json as string)).toContainEqual(
      expect.objectContaining({ type: 'tool/call' }),
    )

    // sessionId ≡ runId: the session log materialized under the run identity.
    const persisted = await ctx.sessionPersistence.list()
    expect(persisted.map(header => String(header.id))).toContain('agent-happy-1')
  })

  it('registers the definition tools in the agent scope', { timeout }, async () => {
    let toolRan = false
    const lookup: ToolDefinition = {
      name: 'lookup',
      description: 'Look up the numeric score.',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'number' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: () => {
        toolRan = true
        return Promise.resolve(41)
      },
    }
    const { ctx } = await loadComposition([
      toolCallResponse('c1', 'lookup', {}),
      toolCallResponse('c2', 'submit', { answer: 42 }),
      textResponse('done'),
    ])
    const def = defineAgent({
      name: 'tool-user',
      version: '1',
      input: z.object({ code: z.string() }),
      output: z.object({ answer: z.number() }),
      prompt: [],
      tools: [lookup],
      model: { provider: 'mock', model: 'mock' },
      maxTurns: 2,
    })
    const bound = await bindAgent(def, ctx)
    const handle = await bound.run({ code: 'x' }, { runId: 'agent-tools-1' })
    await expect(handle.result).resolves.toEqual({ answer: 42 })
    expect(toolRan).toBe(true)
  })

  it('fails the run when the turn completes without a submit', { timeout }, async () => {
    const { ctx, ledgerPath } = await loadComposition([textResponse('no structured answer')])
    const bound = await bindAgent(reviewerDef(), ctx)
    // No explicit runId and no ambient step scope: the engine mints a random identity.
    const handle = await bound.run({ code: 'x' })
    await expect(handle.result).rejects.toSatisfy(
      (error: unknown) => error instanceof RunFailedError
        && error.cause instanceof Error
        && /ended \(last turn: completed\) without calling submit/.test(error.cause.message),
    )
    const [row] = readRuns(ledgerPath)
    expect(row?.run_id).toBe(handle.id)
    expect(row?.status).toBe('failed')
  })

  it('wraps a non-object output schema under a single value parameter', { timeout }, async () => {
    const { ctx } = await loadComposition([
      toolCallResponse('c1', 'submit', { value: 'ship it' }),
      textResponse('done'),
    ])
    const verdict = defineAgent({
      name: 'verdict',
      version: '1',
      input: z.object({ code: z.string() }),
      output: z.string(),
      prompt: [],
      tools: [],
      model: { provider: 'mock', model: 'mock' },
      maxTurns: 2,
    })
    const bound = await bindAgent(verdict, ctx)
    const handle = await bound.run({ code: 'x' }, { runId: 'agent-string-1' })
    await expect(handle.result).resolves.toBe('ship it')
  })

  it('keeps the first submit when the model submits twice', { timeout }, async () => {
    const { ctx } = await loadComposition([
      toolCallResponse('c1', 'submit', { answer: 1 }),
      toolCallResponse('c2', 'submit', { answer: 2 }),
      textResponse('done'),
    ])
    const bound = await bindAgent(reviewerDef(), ctx)
    const handle = await bound.run({ code: 'x' }, { runId: 'agent-twice-1' })
    await expect(handle.result).resolves.toEqual({ answer: 1 })
  })

  it('publishes declared display metadata through the registry read view', { timeout }, async () => {
    const { ctx } = await loadComposition([])
    const def = defineAgent({
      name: 'reviewer',
      version: '1',
      input: z.object({ code: z.string() }),
      output: z.object({ answer: z.number() }),
      prompt: [],
      tools: [],
      model: { provider: 'mock', model: 'mock' },
      maxTurns: 1,
      display: { title: 'Code reviewer', description: 'Reviews code and reports a numeric score.' },
    })
    await bindAgent(def, ctx)
    expect(await ctx.durable.listDefinitions()).toEqual([
      {
        kind: 'agent',
        name: 'reviewer',
        version: '1',
        inputKind: 'json',
        display: { title: 'Code reviewer', description: 'Reviews code and reports a numeric score.' },
      },
    ])
  })

  it('registers without display when undeclared; presenters fall back to the technical name', { timeout }, async () => {
    const { ctx } = await loadComposition([])
    await bindAgent(reviewerDef(), ctx)
    const [entry] = await ctx.durable.listDefinitions()
    // The key is absent (not undefined-valued) so the wire answer stays JSON-safe.
    expect(entry).toStrictEqual({ kind: 'agent', name: 'reviewer', version: '1', inputKind: 'json' })
    expect(entry && 'display' in entry).toBe(false)
    // The documented fallback: a catalog view renders the technical name.
    expect(entry?.display?.title ?? entry?.name).toBe('reviewer')
  })

  it('cancels a mid-turn run through the driver signal', { timeout }, async () => {
    const { ctx, adapter, ledgerPath } = await loadComposition(['hang'])
    const bound = await bindAgent(reviewerDef(), ctx)
    const handle = await bound.run({ code: 'x' }, { runId: 'agent-cancel-1' })
    await until(() => adapter.requests.length === 1)
    await handle.cancel('user-stop')
    await expect(handle.result).rejects.toBeInstanceOf(RunCancelledError)
    const [row] = readRuns(ledgerPath)
    expect(row?.status).toBe('cancelled')
    expect(row?.cancel_cause).toBe('user-stop')
  })

  it('honors a pre-aborted caller signal', { timeout }, async () => {
    const { ctx } = await loadComposition([textResponse('unused')])
    const bound = await bindAgent(reviewerDef(), ctx)
    const controller = new AbortController()
    controller.abort('changed-my-mind')
    const handle = await bound.run({ code: 'x' }, { runId: 'agent-preabort-1', signal: controller.signal })
    await expect(handle.result).rejects.toBeInstanceOf(RunCancelledError)
  })

  it('revives a crashed run through resume plus a synthetic continuation steer', { timeout }, async () => {
    const first = await loadComposition(['hang'])
    const def = reviewerDef()
    const bound1 = await bindAgent(def, first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-revive-1' })
    crashed.result.catch(() => {})
    await until(() => first.adapter.requests.length === 1)
    // The partial first turn must reach durable storage before the "crash".
    await until(async () => (await first.ctx.sessionPersistence.list())
      .some(header => String(header.id) === 'agent-revive-1'))
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition(
      [toolCallResponse('c9', 'submit', { answer: 7 }), textResponse('done')],
      { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot },
    )
    // Registration triggers the boot scan, which revives the unfinished run.
    const bound2 = await bindAgent(reviewerDef(), second.ctx)
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-revive-1' })
    await expect(revived.result).resolves.toEqual({ answer: 7 })

    const texts = second.adapter.requests
      .flatMap(request => request.messages)
      .flatMap(message => message.content)
      .filter(block => block.type === 'text')
      .map(block => block.text)
    expect(texts.some(text => text.includes('host process restarted'))).toBe(true)
    const journal = readJournal(first.ledgerPath, 'agent-revive-1')
    expect(journal.filter(step => step.status === 'completed').length).toBeGreaterThanOrEqual(1)
  })

  it('fails a revived run that would exceed maxTurns', { timeout }, async () => {
    const first = await loadComposition(['hang'])
    const bound1 = await bindAgent(reviewerDef(1), first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-budget-1' })
    crashed.result.catch(() => {})
    await until(() => first.adapter.requests.length === 1)
    await until(async () => (await first.ctx.sessionPersistence.list())
      .some(header => String(header.id) === 'agent-budget-1'))
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition(
      [toolCallResponse('c9', 'submit', { answer: 7 }), textResponse('done')],
      { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot },
    )
    const bound2 = await bindAgent(reviewerDef(1), second.ctx)
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-budget-1' })
    await expect(revived.result).rejects.toSatisfy(
      (error: unknown) => error instanceof RunFailedError
        && error.cause instanceof Error
        && /exceeded maxTurns \(1\)/.test(error.cause.message),
    )
  })

  it('runs a child agent through ctx.agent with derived identity and parent linkage', { timeout }, async () => {
    const { ctx, ledgerPath } = await loadComposition([
      toolCallResponse('c1', 'submit', { answer: 42 }),
      textResponse('done'),
    ])
    const def = reviewerDef()
    await bindAgent(def, ctx)
    const parent = defineWorkflow({
      name: 'parent',
      version: '1',
      input: z.object({ code: z.string() }),
      output: z.object({ verdict: z.number() }),
      body: async (workflow: WorkflowCtx, input) => {
        const reviewed = await workflow.agent(def, { code: input.code })
        return { verdict: reviewed.answer }
      },
    })
    const boundParent = await bind(parent, ctx.durable)
    const handle = await boundParent.run({ code: 'x' }, { runId: 'parent-1' })
    await expect(handle.result).resolves.toEqual({ verdict: 42 })

    const rows = readRuns(ledgerPath)
    const child = rows.find(row => row.run_id !== 'parent-1')
    expect(child?.run_id).toBe('parent-1/agent:reviewer#0/agent:reviewer#0')
    expect(child?.parent_run_id).toBe('parent-1')
    expect(child?.parent_step_key).toBe('agent:reviewer#0')
    expect(child?.status).toBe('done')
    expect(readJournal(ledgerPath, 'parent-1').map(step => step.step_key)).toEqual(['agent:reviewer#0'])
  })

  it('fails loud when ctx.agent references an unbound definition', { timeout }, async () => {
    const { ctx } = await loadComposition([textResponse('unused')])
    const parent = defineWorkflow({
      name: 'parent',
      version: '1',
      input: z.object({ code: z.string() }),
      output: z.object({ verdict: z.number() }),
      body: async (workflow, input) => {
        const reviewed = await workflow.agent(reviewerDef(), { code: input.code })
        return { verdict: reviewed.answer }
      },
    })
    const boundParent = await bind(parent, ctx.durable)
    const handle = await boundParent.run({ code: 'x' }, { runId: 'parent-unbound-1' })
    await expect(handle.result).rejects.toSatisfy(
      (error: unknown) => error instanceof RunFailedError
        && error.cause instanceof Error
        && /is not bound; call bindAgent/.test(error.cause.message),
    )
  })

  it('derives the child runId for the bare sub-workflow idiom and attaches on re-drive', { timeout }, async () => {
    const first = await loadComposition([textResponse('unused')])
    let childExecutions = 0
    // The step body awaits this gate after the child settles, holding the
    // parent step open; each composition installs its own gate.
    let currentGate: Promise<void> = new Promise<void>(() => {})
    const child = defineWorkflow({
      name: 'child-wf',
      version: '1',
      input: z.object({ n: z.number() }),
      output: z.object({ doubled: z.number() }),
      body: async (_workflow, input) => {
        childExecutions += 1
        return { doubled: input.n * 2 }
      },
    })
    let currentChild = await bind(child, first.ctx.durable)
    const parent = defineWorkflow({
      name: 'parent-wf',
      version: '1',
      input: z.object({ n: z.number() }),
      output: z.object({ total: z.number() }),
      body: async (workflow, input) => {
        const out = await workflow.step('invoke', async () => {
          const childHandle = await currentChild.run({ n: input.n })
          const value = await childHandle.result
          await currentGate
          return value
        })
        return { total: out.doubled }
      },
    })
    const boundParent1 = await bind(parent, first.ctx.durable)
    const crashed = await boundParent1.run({ n: 21 }, { runId: 'sub-1' })
    crashed.result.catch(() => {})
    await until(() => childExecutions === 1)
    await until(() => readRuns(first.ledgerPath)
      .some(row => row.run_id === 'sub-1/invoke#0/workflow:child-wf#0' && row.status === 'done'))
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition([textResponse('unused')], {
      ledgerPath: first.ledgerPath,
      sessionsRoot: first.sessionsRoot,
    })
    currentChild = await bind(child, second.ctx.durable)
    currentGate = Promise.resolve()
    const boundParent2 = await bind(parent, second.ctx.durable)
    const revived = await boundParent2.run({ n: 21 }, { runId: 'sub-1' })
    await expect(revived.result).resolves.toEqual({ total: 42 })

    // The child never re-executed: the re-driven parent step attached to the
    // terminal child row through the same derived runId.
    expect(childExecutions).toBe(1)
    const childRow = readRuns(first.ledgerPath)
      .find(row => row.run_id === 'sub-1/invoke#0/workflow:child-wf#0')
    expect(childRow?.parent_run_id).toBe('sub-1')
    expect(childRow?.parent_step_key).toBe('invoke#0')
    expect(readJournal(first.ledgerPath, 'sub-1').map(step => `${step.step_key}:${step.status}`))
      .toEqual(['invoke#0:completed'])
  })

  it('bindAgent fails loud without the services it needs', { timeout }, async () => {
    const bare = new Context()
    contexts.push(bare)
    await expect(bindAgent(reviewerDef(), bare)).rejects.toThrow(/requires the durable engine service/)

    root ??= await mkdtemp(join(tmpdir(), 'daypaw-sdk-agent-'))
    const engineOnly = new Context()
    contexts.push(engineOnly)
    await engineOnly.plugin(DurableEngine, { path: join(root, 'engine-only.db') })
    await expect(bindAgent(reviewerDef(), engineOnly)).rejects.toThrow(/requires the agents and sessions services/)
  })

  it('bindAgent fails loud without a session persistence backend', { timeout }, async () => {
    root ??= await mkdtemp(join(tmpdir(), 'daypaw-sdk-agent-'))
    const ledgerPath = join(root, 'nopersist.db')
    const configPath = join(root, 'cordis-nopersist.yml')
    await writeFile(configPath, [
      '- name: \'@daypaw/engine\'',
      '  config:',
      `    path: ${JSON.stringify(ledgerPath)}`,
      '- name: \'@deepseek-ai/dsh-llm\'',
      '- name: \'@deepseek-ai/dsh-session\'',
      '- name: \'@deepseek-ai/dsh-system-prompt\'',
      '- name: \'@deepseek-ai/dsh-tools\'',
      '- name: \'@deepseek-ai/dsh-agent\'',
      '- name: \'@deepseek-ai/dsh-agent-loop\'',
      '',
    ].join('\n'))
    const ctx = new Context()
    contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@daypaw/engine', DurableEngine],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()
    await expect(bindAgent(reviewerDef(), ctx)).rejects.toThrow(/requires a session persistence backend/)
  })
})

describe('steer channel: multi-segment agent runs (issue #53)', () => {
  const timeout = 60_000

  it('parks a steerable run after a submit-less turn and advances on steer under the same runId', { timeout }, async () => {
    const { ctx, adapter, ledgerPath } = await loadComposition([
      textResponse('I need more context'),
      toolCallResponse('c2', 'submit', { answer: 7 }),
      textResponse('done'),
    ])
    const bound = await bindAgent(reviewerDef(4, true), ctx)
    const handle = await bound.run({ code: 'return 1' }, { runId: 'agent-steer-1' })
    // Turn 1 ends without submit: the run parks instead of failing.
    await until(() => adapter.requests.length === 1)
    await until(() => readJournal(ledgerPath, 'agent-steer-1').some(step => step.step_key === 'dsh-step:1:1' && step.status === 'completed'))
    expect(handle.status()).toEqual({ state: 'running' })

    await handle.steer({ code: 'here is more context' })
    await expect(handle.result).resolves.toEqual({ answer: 7 })
    expect(adapter.requests).toHaveLength(3)
    // The steered input reached the model as a user message in the same session.
    const texts = userTexts(adapter)
    expect(texts.some(text => text === JSON.stringify({ code: 'here is more context' }))).toBe(true)
    expect(texts.some(text => text.includes('host process restarted'))).toBe(false)

    const [row] = readRuns(ledgerPath)
    expect(row?.run_id).toBe('agent-steer-1')
    expect(row?.status).toBe('done')
    expect(JSON.parse(row?.output_json as string)).toEqual({ answer: 7 })
    const journal = readJournal(ledgerPath, 'agent-steer-1')
    const segment = journal.find(step => step.kind === 'segment')
    expect(segment?.step_key).toBe('steer:1')
    expect(JSON.parse(segment?.value_json as string)).toEqual({ code: 'here is more context' })
    // Both turns' dsh steps are journaled under turn-scoped dedup keys.
    expect(journal.filter(step => step.kind === 'step').map(step => step.step_key))
      .toEqual(['dsh-step:1:1', 'dsh-step:2:1', 'dsh-step:2:2'])
  })

  it('revives a run crashed while parked and steers it without a synthetic resume wake', { timeout }, async () => {
    const first = await loadComposition([textResponse('no structured answer')])
    const def = reviewerDef(4, true)
    const bound1 = await bindAgent(def, first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-steer-park-1' })
    crashed.result.catch(() => {})
    // Parked: turn 1 completed without submit.
    await until(() => first.adapter.requests.length === 1)
    await until(async () => (await first.ctx.sessionPersistence.list())
      .some(header => String(header.id) === 'agent-steer-park-1'))
    await until(() => readJournal(first.ledgerPath, 'agent-steer-park-1')
      .some(step => step.step_key === 'dsh-step:1:1' && step.status === 'completed'))
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition(
      [toolCallResponse('c9', 'submit', { answer: 9 }), textResponse('done')],
      { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot },
    )
    const bound2 = await bindAgent(reviewerDef(4, true), second.ctx)
    // The revival of a cleanly parked run re-parks without spending a turn;
    // the steer below is the next wake either way (push to the parked driver,
    // or the pending segment becomes the revival wake when it lands first).
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-steer-park-1' })
    await revived.steer({ code: 'follow up' })
    await expect(revived.result).resolves.toEqual({ answer: 9 })
    expect(second.adapter.requests).toHaveLength(2)
    const texts = userTexts(second.adapter)
    expect(texts.some(text => text.includes('host process restarted'))).toBe(false)
    expect(texts.some(text => text === JSON.stringify({ code: 'follow up' }))).toBe(true)
    // The revived session kept the first turn's history: request 2 carries both user inputs.
    const lastRequest = second.adapter.requests[1]
    const lastTexts = lastRequest?.messages
      .filter(message => message.role === 'user')
      .flatMap(message => message.content)
      .filter(block => block.type === 'text')
      .map(block => block.text) ?? []
    expect(lastTexts).toContain(JSON.stringify({ code: 'x' }))
    expect(lastTexts).toContain(JSON.stringify({ code: 'follow up' }))
    await expect(crashed.result).rejects.toThrow('ENGINE_DISPOSED')
  })

  it('delivers a segment recorded while the process was dead as the revival wake', { timeout }, async () => {
    const first = await loadComposition([textResponse('no structured answer')])
    const bound1 = await bindAgent(reviewerDef(4, true), first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-steer-dead-1' })
    crashed.result.catch(() => {})
    await until(() => first.adapter.requests.length === 1)
    await until(async () => (await first.ctx.sessionPersistence.list())
      .some(header => String(header.id) === 'agent-steer-dead-1'))
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition(
      [toolCallResponse('c9', 'submit', { answer: 5 }), textResponse('done')],
      { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot },
    )
    // The steer lands while no process drives the run — before registration
    // triggers the boot scan.
    await second.ctx.durable.steer('agent-steer-dead-1', { code: 'while dead' })
    const bound2 = await bindAgent(reviewerDef(4, true), second.ctx)
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-steer-dead-1' })
    await expect(revived.result).resolves.toEqual({ answer: 5 })
    const texts = userTexts(second.adapter)
    expect(texts.some(text => text === JSON.stringify({ code: 'while dead' }))).toBe(true)
    expect(texts.some(text => text.includes('host process restarted'))).toBe(false)
    const journal = readJournal(first.ledgerPath, 'agent-steer-dead-1')
    expect(journal.find(step => step.kind === 'segment')?.step_key).toBe('steer:1')
    await expect(crashed.result).rejects.toThrow('ENGINE_DISPOSED')
  })

  it('delivers a pending segment on revival even when the host injected plugin-sourced context (ticket #73)', { timeout }, async () => {
    const first = await loadComposition([textResponse('no structured answer')])
    const bound1 = await bindAgent(reviewerDef(4, true), first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-steer-injected-1' })
    crashed.result.catch(() => {})
    await until(() => first.adapter.requests.length === 1)
    await until(() => readJournal(first.ledgerPath, 'agent-steer-injected-1')
      .some(step => step.step_key === 'dsh-step:1:1' && step.status === 'completed'))
    // The product-shell shape under test: a producer injects a plugin-sourced
    // context snapshot into the parked session (the runtime-context projector
    // does exactly this on hosts with dynamic prompt sections).
    first.ctx.sessions.get(SessionId('agent-steer-injected-1'))?.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' }],
      source: {
        kind: 'plugin',
        plugin: 'dsh/agent-loop/runtime-context',
        form: 'snapshot',
        sections: [{ name: 'sandbox:policy', text: 'sandbox: policy snapshot' }],
      },
    }), { surfaceOp: 'append' })
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition(
      [toolCallResponse('c9', 'submit', { answer: 6 }), textResponse('done')],
      { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot },
    )
    await second.ctx.durable.steer('agent-steer-injected-1', { code: 'while dead' })
    const bound2 = await bindAgent(reviewerDef(4, true), second.ctx)
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-steer-injected-1' })
    await expect(revived.result).resolves.toEqual({ answer: 6 })
    const texts = userTexts(second.adapter)
    expect(texts.some(text => text === JSON.stringify({ code: 'while dead' }))).toBe(true)
    expect(texts.some(text => text.includes('host process restarted'))).toBe(false)
    await expect(crashed.result).rejects.toThrow('ENGINE_DISPOSED')
  })

  it('wakes a steerable run crashed mid-turn with the synthetic resume steer', { timeout }, async () => {
    const first = await loadComposition(['hang'])
    const bound1 = await bindAgent(reviewerDef(4, true), first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-steer-crash-1' })
    crashed.result.catch(() => {})
    await until(() => first.adapter.requests.length === 1)
    // The partial first turn must reach durable storage before the "crash".
    await until(async () => (await first.ctx.sessionPersistence.list())
      .some(header => String(header.id) === 'agent-steer-crash-1'))
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition(
      [toolCallResponse('c9', 'submit', { answer: 3 }), textResponse('done')],
      { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot },
    )
    const bound2 = await bindAgent(reviewerDef(4, true), second.ctx)
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-steer-crash-1' })
    await expect(revived.result).resolves.toEqual({ answer: 3 })
    // The persistence layer closed the orphaned turn with the interrupted
    // marker, so the revival continues the turn with the resume wake instead
    // of re-parking.
    const texts = userTexts(second.adapter)
    expect(texts.some(text => text.includes('host process restarted'))).toBe(true)
    await expect(crashed.result).rejects.toThrow('ENGINE_DISPOSED')
  })

  it('re-parks a revival whose recorded segments are all delivered, spending no turn', { timeout }, async () => {
    const first = await loadComposition([textResponse('need more'), textResponse('still not enough')])
    const bound1 = await bindAgent(reviewerDef(4, true), first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-steer-repark-1' })
    crashed.result.catch(() => {})
    // Turn 1 parks; the steer is delivered and turn 2 parks again.
    await until(() => first.adapter.requests.length === 1)
    await until(() => readJournal(first.ledgerPath, 'agent-steer-repark-1')
      .some(step => step.step_key === 'dsh-step:1:1' && step.status === 'completed'))
    await crashed.steer({ code: 'more' })
    await until(() => first.adapter.requests.length === 2)
    await until(() => readJournal(first.ledgerPath, 'agent-steer-repark-1')
      .some(step => step.step_key === 'dsh-step:2:1' && step.status === 'completed'))
    // Turn 2's close must be durable before the "crash", or the revival would
    // re-deliver the segment (model-visible ⟺ logged ordinal dedup).
    await until(async () => {
      const inspection = await first.ctx.sessionPersistence.inspect(SessionId('agent-steer-repark-1'))
      return inspection.events.some(event => event.type === 'turn/end' && event.data.turn === 2)
    })
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition([], { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot })
    const bound2 = await bindAgent(reviewerDef(4, true), second.ctx)
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-steer-repark-1' })
    // No new segment is recorded: the revival re-parks without a wake.
    await revived.cancel('test-complete')
    await expect(revived.result).rejects.toBeInstanceOf(RunCancelledError)
    expect(second.adapter.requests).toHaveLength(0)
    const journal = readJournal(first.ledgerPath, 'agent-steer-repark-1')
    expect(journal.filter(step => step.kind === 'segment').map(step => step.step_key)).toEqual(['steer:1'])
    await expect(crashed.result).rejects.toThrow('ENGINE_DISPOSED')
  })

  it('fails loud when a recorded segment violates the input contract', { timeout }, async () => {
    const { ctx, adapter, ledgerPath } = await loadComposition([textResponse('need more')])
    const bound = await bindAgent(reviewerDef(4, true), ctx)
    const handle = await bound.run({ code: 'x' }, { runId: 'agent-steer-invalid-1' })
    await until(() => adapter.requests.length === 1)
    await until(() => readJournal(ledgerPath, 'agent-steer-invalid-1')
      .some(step => step.step_key === 'dsh-step:1:1' && step.status === 'completed'))
    // A writer holding only the engine face records a segment the agent's
    // input contract rejects; consumption fails the run rather than feeding
    // the model an unvalidated shape.
    await ctx.durable.steer('agent-steer-invalid-1', { notCode: 1 })
    await expect(handle.result).rejects.toSatisfy(
      (error: unknown) => error instanceof RunFailedError
        && error.cause instanceof Error
        && /code/.test(error.cause.message),
    )
    const [row] = readRuns(ledgerPath)
    expect(row?.status).toBe('failed')
  })

  it('ignores a foreign multi-block user message when deduping delivered segments', { timeout }, async () => {
    const first = await loadComposition([textResponse('no structured answer')])
    const bound1 = await bindAgent(reviewerDef(4, true), first.ctx)
    const crashed = await bound1.run({ code: 'x' }, { runId: 'agent-steer-foreign-1' })
    crashed.result.catch(() => {})
    await until(() => first.adapter.requests.length === 1)
    await until(async () => (await first.ctx.sessionPersistence.list())
      .some(header => String(header.id) === 'agent-steer-foreign-1'))
    // A writer outside the run flow records a complete turn whose user message
    // carries two text blocks. Run-owned inputs are always single-text, so the
    // ordinal dedup must not count it.
    const inspection = await first.ctx.sessionPersistence.inspect(SessionId('agent-steer-foreign-1'))
    const nextSeq = (inspection.events.at(-1)?.seq ?? 0) + 1
    const foreignTurn: SessionEvent[] = [
      {
        type: 'turn/start', seq: nextSeq, time: Date.now(),
        data: { turn: 2 },
      },
      {
        type: 'user/message', seq: nextSeq + 1, time: Date.now(),
        data: createUserMessage({
          content: [
            { type: 'text', text: 'foreign part 1' },
            { type: 'text', text: 'foreign part 2' },
          ],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'turn/end', seq: nextSeq + 2, time: Date.now(),
        data: { turn: 2, reason: { kind: 'completed' } },
      },
    ]
    await first.ctx.sessionPersistence.append(SessionId('agent-steer-foreign-1'), foreignTurn)
    contexts = contexts.filter(item => item !== first.ctx)
    await first.ctx.fiber.dispose()

    const second = await loadComposition(
      [toolCallResponse('c9', 'submit', { answer: 6 }), textResponse('done')],
      { ledgerPath: first.ledgerPath, sessionsRoot: first.sessionsRoot },
    )
    // The steer lands while no process drives the run. Were the foreign
    // message miscounted as a delivered segment, the revival would re-park
    // and this run would never complete.
    await second.ctx.durable.steer('agent-steer-foreign-1', { code: 'real follow up' })
    const bound2 = await bindAgent(reviewerDef(4, true), second.ctx)
    const revived = await bound2.run({ code: 'x' }, { runId: 'agent-steer-foreign-1' })
    await expect(revived.result).resolves.toEqual({ answer: 6 })
    const texts = userTexts(second.adapter)
    expect(texts.some(text => text === JSON.stringify({ code: 'real follow up' }))).toBe(true)
    await expect(crashed.result).rejects.toThrow('ENGINE_DISPOSED')
  })
})
