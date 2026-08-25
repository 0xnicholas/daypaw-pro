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
import SessionStore from '@deepseek-ai/dsh-session'
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
function reviewerDef(maxTurns = 4): AgentDefinition<
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
  })
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
        display: { title: 'Code reviewer', description: 'Reviews code and reports a numeric score.' },
      },
    ])
  })

  it('registers without display when undeclared; presenters fall back to the technical name', { timeout }, async () => {
    const { ctx } = await loadComposition([])
    await bindAgent(reviewerDef(), ctx)
    const [entry] = await ctx.durable.listDefinitions()
    // toStrictEqual pins the `display: undefined` key the fallback contract documents.
    expect(entry).toStrictEqual({ kind: 'agent', name: 'reviewer', version: '1', display: undefined })
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
