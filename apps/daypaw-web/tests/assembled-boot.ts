// The daypaw web lane's assembled-boot entry: the shared parameterized
// scaffolding (@daypaw/assembled-boot) carrying the fork roster (the
// packages/daypaw/web-app layer over the base bundle) and the carrier
// transport — the page installs the connection plugin's override
// (`__DSH_TRANSPORT__`) over the fork's RemoteMock world wrapped with the
// fork's `durable/*` decorator, so the mounted graph rides the same
// ClientRequest/ServerResponse envelope the served web app's HTTP carrier
// uses. Composition, environment, and mount behavior live in the shared
// module; the roster layer, title, carrier wiring, and the teardown's
// unmatched-assertion live here.
//
// Keyless and deterministic: the mock is the fake server, so nothing here
// reaches a model or the network.
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { connectionRpcCarrier, createAssembledBootLane, hasClass, REFRESHING_GOLDEN } from '@daypaw/assembled-boot'
import { createDaypawRemote, type DaypawRemote } from './daypaw-remote.ts'
import { decorateDurableRpc } from './durable-rpc.ts'

/** The world of the most recent mount; the teardown asserts it before clearing. */
let world: DaypawRemote | undefined

const lane = await createAssembledBootLane({
  webBundle: {
    manifest: join(process.cwd(), 'packages/daypaw/web-app/package.json'),
    patch: join(process.cwd(), 'packages/daypaw/web-app/cordis.patch.yml'),
  },
  documentTitle: 'daypaw',
  carrier: () => {
    world = createDaypawRemote()
    return connectionRpcCarrier(decorateDurableRpc(world.mock.rpc))
  },
})

export function installAssembledBootEnv(): void {
  // Registered before the lane's own teardown (vitest runs afterEach hooks in
  // reverse registration order), so the app unmounts and closes its streams
  // before the world asserts every request it saw was declared.
  afterEach(() => {
    try {
      world?.mock.assertNoUnmatched()
    } finally {
      world = undefined
    }
  })
  lane.installAssembledBootEnv()
}

export const mountAssembledApp = lane.mountAssembledApp
export { hasClass, REFRESHING_GOLDEN }
