/** The run-status vocabulary: the unfinished partition and the copy-key mapping. */
import { describe, expect, it } from 'vitest'
import { isUnfinishedWireRun, runStatusKey } from '../src/client/status.ts'

describe('isUnfinishedWireRun', () => {
  it('partitions the five statuses into unfinished and finished', () => {
    expect(isUnfinishedWireRun('running')).toBe(true)
    expect(isUnfinishedWireRun('waiting')).toBe(true)
    expect(isUnfinishedWireRun('done')).toBe(false)
    expect(isUnfinishedWireRun('failed')).toBe(false)
    expect(isUnfinishedWireRun('cancelled')).toBe(false)
  })
})

describe('runStatusKey', () => {
  it('maps every status to its durable-namespace copy key', () => {
    expect(runStatusKey('running')).toBe('status.running')
    expect(runStatusKey('waiting')).toBe('status.waiting')
    expect(runStatusKey('done')).toBe('status.done')
    expect(runStatusKey('failed')).toBe('status.failed')
    expect(runStatusKey('cancelled')).toBe('status.cancelled')
  })
})
