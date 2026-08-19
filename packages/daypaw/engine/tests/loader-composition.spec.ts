import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import DurableEngine from '@daypaw/engine'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('durable engine through a real Loader composition', () => {
  it('applies the ledger path from a Cordis row and completes a run', async () => {
    root = await mkdtemp(join(tmpdir(), 'daypaw-engine-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@daypaw/engine'",
      '  config:',
      `    path: ${JSON.stringify(join(root, 'ledger.db'))}`,
      '    pollMs: 10',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@daypaw/engine') return DurableEngine
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const engine = context.durable
    expect(engine).toBeInstanceOf(DurableEngine)
    const def = {
      kind: 'workflow' as const,
      name: 'loader-demo',
      version: '1',
      body: async (run: { step<T>(name: string, fn: () => Promise<T>): Promise<T> }) =>
        (await run.step('only', async () => 'loader-ok')),
    }
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'loader-1' })
    await expect(handle.result).resolves.toBe('loader-ok')
  })
})
