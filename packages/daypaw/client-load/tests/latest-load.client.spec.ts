/** LatestLoad: the newest-wins settlement rule every shell store's load path shares. */
import { describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LatestLoad, type LoadPolicy } from '../src/index.ts'

/** The smallest state the policy hooks can fold into. */
interface TestState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  value?: string
  error?: unknown
}

/** A store plus the controller under test, one per case. */
function subject(): { store: ReturnType<typeof createSnapshotStore<TestState>>; loads: LatestLoad<TestState> } {
  const store = createSnapshotStore<TestState>({ status: 'idle' })
  return { store, loads: new LatestLoad(store) }
}

describe('LatestLoad.run', () => {
  it('applies the start writes before the read settles, then the newest success', async () => {
    const { store, loads } = subject()
    const read = Promise.withResolvers<string>()
    const settled = loads.run(() => read.promise, {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
    })
    expect(store.getSnapshot()).toEqual({ status: 'loading' })
    read.resolve('first')
    await settled
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: 'first' })
  })

  it('runs without a start policy', async () => {
    const { store, loads } = subject()
    await loads.run(() => Promise.resolve('value'), {
      success: (s, data) => { s.status = 'ready'; s.value = data },
    })
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: 'value' })
  })

  it('hands the rejection value to the failure policy', async () => {
    const { store, loads } = subject()
    const boom = new Error('boom')
    await loads.run(() => Promise.reject(boom), {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
      failure: (s, error) => { s.status = 'error'; s.error = error },
    })
    expect(store.getSnapshot()).toEqual({ status: 'error', error: boom })
  })

  it('resolves without writing when the failure policy is omitted', async () => {
    const { store, loads } = subject()
    await expect(loads.run(() => Promise.reject(new Error('boom')), {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
    })).resolves.toBeUndefined()
    expect(store.getSnapshot()).toEqual({ status: 'loading' })
  })

  it('drops a superseded success', async () => {
    const { store, loads } = subject()
    const stale = Promise.withResolvers<string>()
    const staleRun = loads.run(() => stale.promise, {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
    })
    await loads.run(() => Promise.resolve('fresh'), {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
    })
    stale.resolve('stale')
    await staleRun
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: 'fresh' })
  })

  it('drops a superseded failure', async () => {
    const { store, loads } = subject()
    const stale = Promise.withResolvers<string>()
    const staleRun = loads.run(() => stale.promise, {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
      failure: (s, error) => { s.status = 'error'; s.error = error },
    })
    await loads.run(() => Promise.resolve('fresh'), {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
      failure: (s, error) => { s.status = 'error'; s.error = error },
    })
    stale.reject(new Error('stale'))
    await expect(staleRun).resolves.toBeUndefined()
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: 'fresh' })
  })

  it('runs the start writes of every attempt, including a superseded one', async () => {
    const { store, loads } = subject()
    const seen: string[] = []
    const policy = (label: string): LoadPolicy<TestState, string> => ({
      start: (s) => { seen.push(`${label}:start`); s.status = 'loading' },
      success: (s, data) => { seen.push(`${label}:success`); s.status = 'ready'; s.value = data },
    })
    const stale = Promise.withResolvers<string>()
    const staleRun = loads.run(() => stale.promise, policy('stale'))
    await loads.run(() => Promise.resolve('fresh'), policy('fresh'))
    stale.resolve('stale')
    await staleRun
    expect(seen).toEqual(['stale:start', 'fresh:start', 'fresh:success'])
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: 'fresh' })
  })
})

describe('LatestLoad.invalidate', () => {
  it('drops an in-flight attempt without writing', async () => {
    const { store, loads } = subject()
    const stale = Promise.withResolvers<string>()
    const staleRun = loads.run(() => stale.promise, {
      start: (s) => { s.status = 'loading' },
      success: (s, data) => { s.status = 'ready'; s.value = data },
      failure: (s, error) => { s.status = 'error'; s.error = error },
    })
    loads.invalidate()
    store.set({ status: 'idle' })
    stale.resolve('stale')
    await staleRun
    expect(store.getSnapshot()).toEqual({ status: 'idle' })
  })

  it('is a no-op with no attempt in flight, and a later run still writes', async () => {
    const { store, loads } = subject()
    loads.invalidate()
    expect(store.getSnapshot()).toEqual({ status: 'idle' })
    await loads.run(() => Promise.resolve('value'), {
      success: (s, data) => { s.status = 'ready'; s.value = data },
    })
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: 'value' })
  })
})
