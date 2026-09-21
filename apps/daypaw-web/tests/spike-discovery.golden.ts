// @vitest-environment jsdom
// SPIKE ONLY (branch spike/remote-mock-task-approval): discover which Remote
// endpoints the assembled fork roster actually calls, by booting the real
// built bundles over a RemoteMock that answers only the tier's boot defaults
// and dumping the mock log. Removed before any landing.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { remoteDefaultResponses } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses.ts'
import { connectionRpcCarrier, createAssembledBootLane } from '@daypaw/assembled-boot'
import { decorateDurableRpc } from './durable-rpc.ts'

const mock = RemoteMock.create()
mock.load(remoteDefaultResponses)

const lane = await createAssembledBootLane({
  webBundle: {
    manifest: join(process.cwd(), 'packages/daypaw/web-app/package.json'),
    patch: join(process.cwd(), 'packages/daypaw/web-app/cordis.patch.yml'),
  },
  documentTitle: 'daypaw',
  carrier: () => connectionRpcCarrier(decorateDurableRpc(mock.rpc)),
})

lane.installAssembledBootEnv()

describe('spike: endpoint discovery', () => {
  it('dumps what the booted roster asked for', async () => {
    lane.mountAssembledApp()
    await new Promise<void>((resolve) => { setTimeout(resolve, 8_000) })
    const calls = mock.log.calls().map(entry => entry.endpoint)
    const streams = mock.log.streams().map(entry => entry.endpoint)
    const unmatched = mock.log.unmatched()
    const counts = Object.entries(calls.reduce<Record<string, number>>((acc, endpoint) => {
      acc[endpoint] = (acc[endpoint] ?? 0) + 1
      return acc
    }, {})).sort()
    writeFileSync('/tmp/spike-discovery.json', JSON.stringify({
      calls: [...new Set(calls)].sort(),
      counts,
      streams,
      unmatched,
      bodyText: (document.body.textContent ?? '').slice(0, 1_500),
    }, null, 2))
    console.log('SPIKE_CALLS', JSON.stringify([...new Set(calls)].sort()))
  }, 60_000)
})
