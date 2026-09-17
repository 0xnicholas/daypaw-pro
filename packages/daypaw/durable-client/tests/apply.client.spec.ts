/** durable-client apply: declares only the locale service and registers the dictionaries. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'

// The locale service reads its initial locale from the browser; these specs
// assert the shipped dictionaries, so they state the browser they assume.
async function bench(locale: 'zh' | 'en') {
  const ctx = new Context()
  const runtime = new LocaleRuntime(ctx)
  runtime.setLocale(locale)
  ctx.provide('locale', runtime)
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, runtime }
}

describe('durable-client apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['locale'])
  })

  it('the node half provides no host-side behavior', () => {
    applyNodeHalf()
  })

  it('registers the status vocabulary in both languages', async () => {
    const zhBench = await bench('zh')
    expect(zhBench.runtime.bind('durable')('status.running')).toBe('进行中')
    expect(zhBench.runtime.bind('durable')('status.waiting')).toBe('等待确认')
    expect(zhBench.runtime.bind('durable')('status.done')).toBe('已完成')
    expect(zhBench.runtime.bind('durable')('status.failed')).toBe('出错了')
    expect(zhBench.runtime.bind('durable')('status.cancelled')).toBe('已取消')
    await zhBench.ctx.fiber.dispose()

    const enBench = await bench('en')
    expect(enBench.runtime.bind('durable')('status.done')).toBe('Completed')
    expect(enBench.runtime.bind('durable')('status.failed')).toBe('Failed')
    await enBench.ctx.fiber.dispose()
  })

  it('deregisters with the plugin fiber', async () => {
    const b = await bench('zh')
    await b.ctx.fiber.dispose()
    // A deregistered dictionary falls back to the raw key.
    expect(b.runtime.bind('durable')('status.running')).toBe('status.running')
  })
})
