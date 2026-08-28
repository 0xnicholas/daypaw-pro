/**
 * The agents-directory loader (ruling #65, ADR 0012): injected-factory
 * files, deterministic load order, empty-roster and fail-loud contracts.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { DurableEngine } from '@daypaw/sdk'
import { loadAgentFiles } from '../src/agents-dir.ts'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.length = 0
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the loader's host face: engine plus the dsh agent stack bindAgent requires. */
async function boot(): Promise<Context> {
  root ??= await mkdtemp(join(tmpdir(), 'daypaw-sdk-agents-'))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(DurableEngine, { path: join(root, `ledger-${contexts.length}.db`), pollMs: 20 })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  return ctx
}

/** Stage one agents directory holding the given files. */
async function agentsDir(files: Record<string, string>): Promise<string> {
  root ??= await mkdtemp(join(tmpdir(), 'daypaw-sdk-agents-'))
  const dir = join(root, `agents-${contexts.length}-${Object.keys(files).length}`)
  await mkdir(dir, { recursive: true })
  for (const [name, source] of Object.entries(files)) await writeFile(join(dir, name), source)
  return dir
}

/** An agent factory file body. */
function agentFile(name: string, input: string): string {
  return `export default ({ defineAgent, z }) => defineAgent({
  name: ${JSON.stringify(name)}, version: '1',
  input: ${input}, output: z.object({ done: z.boolean() }),
  prompt: [], tools: [], model: { provider: 'mock', model: 'mock' }, maxTurns: 2,
})
`
}

/** A workflow factory file body. */
function workflowFile(name: string): string {
  return `export default ({ defineWorkflow, z }) => defineWorkflow({
  name: ${JSON.stringify(name)}, version: '3',
  input: z.object({ code: z.string() }), output: z.object({ ok: z.boolean() }),
  body: async (ctx, input) => ({ ok: input.code.length > 0 }),
})
`
}

describe('loadAgentFiles', () => {
  it('treats an absent directory as the legal empty roster', async () => {
    const ctx = await boot()
    await expect(loadAgentFiles(ctx, join(root!, 'never-created'))).resolves.toEqual([])
  })

  it('loads an agent file, binds it, and projects the starter text shape', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ 'assistant.mjs': agentFile('loaded-agent', 'z.object({ task: z.string() })') })
    await expect(loadAgentFiles(ctx, dir)).resolves.toEqual([
      { file: 'assistant.mjs', kind: 'agent', name: 'loaded-agent', version: '1' },
    ])
    const views = await ctx.durable.listDefinitions()
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ kind: 'agent', name: 'loaded-agent', version: '1', inputKind: 'text' })
  })

  it('loads a workflow file and projects a bare z.string() input as text', async () => {
    const ctx = await boot()
    const dir = await agentsDir({
      'flow.mjs': workflowFile('loaded-flow'),
      'plain.mjs': agentFile('plain-agent', 'z.string()'),
    })
    await loadAgentFiles(ctx, dir)
    const views = await ctx.durable.listDefinitions()
    expect(views.find(view => view.name === 'loaded-flow')?.inputKind).toBe('json')
    expect(views.find(view => view.name === 'plain-agent')?.inputKind).toBe('text')
  })

  it('loads multi-definition files and keeps name order across files', async () => {
    const ctx = await boot()
    const dir = await agentsDir({
      'b-second.mjs': agentFile('zulu', 'z.object({ task: z.string() })'),
      'a-first.mjs': `export default ({ defineAgent, defineWorkflow, z }) => [
  defineAgent({
    name: 'alpha', version: '2',
    input: z.object({ code: z.string() }), output: z.object({ done: z.boolean() }),
    prompt: [], tools: [], model: { provider: 'mock', model: 'mock' }, maxTurns: 2,
  }),
  defineWorkflow({
    name: 'alpha-flow', version: '1',
    input: z.object({ code: z.string() }), output: z.object({ ok: z.boolean() }),
    body: async (ctx, input) => ({ ok: input.code.length > 0 }),
  }),
]
`,
    })
    const loaded = await loadAgentFiles(ctx, dir)
    expect(loaded).toEqual([
      { file: 'a-first.mjs', kind: 'agent', name: 'alpha', version: '2' },
      { file: 'a-first.mjs', kind: 'workflow', name: 'alpha-flow', version: '1' },
      { file: 'b-second.mjs', kind: 'agent', name: 'zulu', version: '1' },
    ])
  })

  it('ignores non-module entries and subdirectories', async () => {
    const ctx = await boot()
    const dir = await agentsDir({
      'notes.md': '# not a module',
      'helper.txt': 'nope',
      'snapshot.json': '{}',
    })
    await mkdir(join(dir, 'subdir'), { recursive: true })
    await expect(loadAgentFiles(ctx, dir)).resolves.toEqual([])
  })

  it('loads dot-prefixed module files like any other (fail loud applies)', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ '.draft.mjs': 'export default null\n' })
    await expect(loadAgentFiles(ctx, dir)).rejects.toThrow(
      'daypaw agents: .draft.mjs default-exports no factory',
    )
  })

  it('projects every non-starter input shape as json', async () => {
    const ctx = await boot()
    const dir = await agentsDir({
      'shapes.mjs': `export default ({ defineAgent, z }) => [
  defineAgent({
    name: 'multi-key', version: '1',
    input: z.object({ task: z.string(), extra: z.string() }), output: z.object({ done: z.boolean() }),
    prompt: [], tools: [], model: { provider: 'mock', model: 'mock' }, maxTurns: 2,
  }),
  defineAgent({
    name: 'task-number', version: '1',
    input: z.object({ task: z.number() }), output: z.object({ done: z.boolean() }),
    prompt: [], tools: [], model: { provider: 'mock', model: 'mock' }, maxTurns: 2,
  }),
  defineAgent({
    name: 'numbered', version: '1',
    input: z.number(), output: z.object({ done: z.boolean() }),
    prompt: [], tools: [], model: { provider: 'mock', model: 'mock' }, maxTurns: 2,
  }),
]
`,
    })
    await loadAgentFiles(ctx, dir)
    const views = await ctx.durable.listDefinitions()
    expect(views.find(view => view.name === 'multi-key')?.inputKind).toBe('json')
    expect(views.find(view => view.name === 'task-number')?.inputKind).toBe('json')
    expect(views.find(view => view.name === 'numbered')?.inputKind).toBe('json')
  })

  it('validates wire input through the loaded definition parseInput', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ 'flow.mjs': workflowFile('checked-flow') })
    await loadAgentFiles(ctx, dir)
    const started = await ctx.durable.startRun({ defName: 'checked-flow', input: { code: 'x' } })
    const deadline = Date.now() + 2_000
    while ((await ctx.durable.listRuns()).every(run => run.run_id !== started.runId || run.status === 'running')) {
      if (Date.now() > deadline) throw new Error('run never settled')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const row = (await ctx.durable.listRuns()).find(run => run.run_id === started.runId)
    expect(row?.status).toBe('done')
    await expect(ctx.durable.startRun({ defName: 'checked-flow', input: { code: 7 } })).rejects.toThrow()
  })

  it('fails loud when the directory path is a regular file', async () => {
    const ctx = await boot()
    root ??= await mkdtemp(join(tmpdir(), 'daypaw-sdk-agents-'))
    const blocker = join(root, `blocker-${contexts.length}.mjs`)
    await writeFile(blocker, 'export default null\n')
    // readdir on a file path fails with a non-ENOENT code, which rethrows as-is.
    await expect(loadAgentFiles(ctx, blocker)).rejects.toThrow(/ENOTDIR|EISDIR|not a directory/i)
  })

  it('fails loud naming the file when the default export is no factory', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ 'broken.mjs': 'export default 42\n' })
    await expect(loadAgentFiles(ctx, dir)).rejects.toThrow(
      'daypaw agents: broken.mjs default-exports no factory (expected: export default ({ defineAgent, defineWorkflow, z }) => definition)',
    )
  })

  it('fails loud naming the file and cause when the factory throws', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ 'throws.mjs': 'export default () => { throw new Error("author bug") }\n' })
    await expect(loadAgentFiles(ctx, dir)).rejects.toThrow('daypaw agents: throws.mjs factory failed: author bug')
  })

  it('fails loud naming the file when the factory produces a non-definition', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ 'garbage.mjs': 'export default ({ z }) => z.object({ task: z.string() })\n' })
    await expect(loadAgentFiles(ctx, dir)).rejects.toThrow(
      'daypaw agents: garbage.mjs produced an object with kind undefined, not a definition',
    )
  })

  it('fails loud describing a null or non-object factory product', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ 'nullish.mjs': 'export default () => null\n' })
    await expect(loadAgentFiles(ctx, dir)).rejects.toThrow(
      'daypaw agents: nullish.mjs produced a object, not a definition',
    )
  })

  it('fails loud naming the file and a non-Error throw cause', async () => {
    const ctx = await boot()
    const dir = await agentsDir({ 'throwstring.mjs': 'export default () => { throw "plain string" }\n' })
    await expect(loadAgentFiles(ctx, dir)).rejects.toThrow(
      'daypaw agents: throwstring.mjs factory failed: plain string',
    )
  })

  it('fails loud when a workflow file loads without the engine service', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const dir = await agentsDir({ 'flow.mjs': workflowFile('orphan-flow') })
    await expect(loadAgentFiles(ctx, dir)).rejects.toThrow(
      'daypaw agents: flow.mjs declares workflow orphan-flow but the durable engine service is not mounted (mount @daypaw/engine)',
    )
  })
})
