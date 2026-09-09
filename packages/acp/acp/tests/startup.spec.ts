/**
 * Serving-start contract of the ACP bridge: the server answers for the
 * composed application, so with an owning Loader tree it serves only once the
 * tree settles (and never when the tree failed to settle).
 * @module
 */

import { describe, expect, it } from 'vitest'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

/** Yield past every pending microtask so an already-started server would have answered. */
async function flushTasks(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}

/** Send one initialize request, flipping `answered` only once the server answers it. */
function requestInitialize(client: BridgeHarness['client']): { answered: () => boolean; promise: Promise<unknown> } {
  let answered = false
  const promise = Promise.resolve(client.initialize({ protocolVersion: 1, clientCapabilities: {} }))
    .then((result) => {
      answered = true
      return result
    })
  return { answered: () => answered, promise }
}

describe('ACP serving start', () => {
  it('serves no request until the owning loader tree settles', async () => {
    const settled: PromiseWithResolvers<void> = Promise.withResolvers()
    const harness = await makeBridgeHarness({ loaderAwait: () => settled.promise })
    try {
      const request = requestInitialize(harness.client)
      await flushTasks()
      expect(request.answered()).toBe(false)

      settled.resolve()
      await expect(request.promise).resolves.toMatchObject({ protocolVersion: 1 })
    } finally {
      await harness.dispose()
    }
  })

  it('serves immediately once a loader tree has already settled', async () => {
    const harness = await makeBridgeHarness({ loaderAwait: () => Promise.resolve() })
    try {
      const request = requestInitialize(harness.client)
      await expect(request.promise).resolves.toMatchObject({ protocolVersion: 1 })
    } finally {
      await harness.dispose()
    }
  })

  it('never serves when the loader tree failed to settle', async () => {
    const harness = await makeBridgeHarness({ loaderAwait: () => Promise.reject(new Error('sibling entry failed to apply')) })
    try {
      // The request can only settle through the test's own teardown; the
      // catch keeps its eventual rejection observed.
      const request = requestInitialize(harness.client)
      void request.promise.catch(() => undefined)
      await flushTasks()
      expect(request.answered()).toBe(false)
    } finally {
      await harness.dispose()
    }
  })

  it('starts nothing when teardown beat the settle barrier', async () => {
    const settled: PromiseWithResolvers<void> = Promise.withResolvers()
    const harness = await makeBridgeHarness({ loaderAwait: () => settled.promise })
    try {
      const request = requestInitialize(harness.client)
      void request.promise.catch(() => undefined)
      await harness.ctx.fiber.dispose()
      settled.resolve()
      await flushTasks()
      expect(request.answered()).toBe(false)
    } finally {
      await harness.dispose()
    }
  })
})
