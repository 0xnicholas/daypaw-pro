// @vitest-environment jsdom
/**
 * Plugin face over the real slot registry: the ledger tab lands in the
 * configured view-ring slot (the default is upstream's conversation ring; a
 * composition whose shell never renders that ring points `viewSlot` at its own
 * declared ring — the retarget that hosts the ledger in a replacement shell).
 */
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, Config, inject } from '../src/client/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Test-only host ring for the retargeted registration. */
    'test.inspector.ring': { kind: 'list'; scope: 'session' }
  }
}

const contexts: Context[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
})

/** Mount the plugin face over a real registry with both rings declared. */
async function mount(config?: Record<string, unknown>): Promise<SlotRegistry> {
  const ctx = new Context()
  contexts.push(ctx)
  const slots = new SlotRegistry(ctx)
  ctx.provide('uiSession', { provide: () => () => {} } as never)
  // The conversation host's role: the rings must exist before riders land.
  slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'test.inspector.ring': { kind: 'list', scope: 'session' },
    },
  }, (_props: { renderSlot?: unknown }) => null)
  const sessions = { binding: () => undefined }
  ctx.provide('sessions', sessions)
  new UiConversation(ctx, sessions as never)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const locale = await import('@deepseek-ai/dsh-client-locale/client')
  ctx.plugin({ inject: [...locale.inject], apply: locale.apply })
  const fiber = ctx.plugin({ inject, apply } as never, config as never)
  await fiber.await()
  return slots
}

describe('apply', () => {
  it('registers the ledger tab into the upstream conversation ring by default', async () => {
    const slots = await mount()
    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['trajectory'])
    expect(slots.entries('test.inspector.ring')).toHaveLength(0)
  })

  it('retargets the registration into the configured view-ring slot', async () => {
    const slots = await mount({ viewSlot: 'test.inspector.ring' })
    expect(slots.entries('test.inspector.ring').map(entry => entry.options.id)).toEqual(['trajectory'])
    // The upstream ring the replacement shell never renders stays empty: one
    // registration, one host, no duplicate image-slot declaration.
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('defaults the view-ring slot to the conversation ring', () => {
    expect(Config({})).toEqual({ viewSlot: 'conversation.view' })
  })
})
