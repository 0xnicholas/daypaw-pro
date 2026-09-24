// The daypaw web lane's assembled-boot entry: the shared parameterized
// scaffolding (@daypaw/assembled-boot) carrying the fork roster (the
// packages/daypaw/web-app layer over the base bundle) and the fork's
// RemoteMock world (daypaw-remote.ts) as the page's carrier transport — the
// `durable/*` decorator (durable-rpc.ts) wraps the mock's rpc before the
// page installs it as `__DSH_TRANSPORT__`, so those seven endpoints answer on
// the decorator's short circuit while every other face rides the mock.
// Composition, environment, mount behavior, and the teardown's
// unmatched-assertion live in the shared module; the roster layer, title,
// and the scenario-with-decorator wiring live here.
//
// Keyless and deterministic: the mock is the fake server, so nothing here
// reaches a model or the network.
import { join } from 'node:path'
import { createAssembledBootLane, hasClass, REFRESHING_GOLDEN } from '@daypaw/assembled-boot'
import { createDaypawRemote } from './daypaw-remote.ts'
import { decorateDurableRpc } from './durable-rpc.ts'

const lane = await createAssembledBootLane({
  webBundle: {
    dir: join(process.cwd(), 'packages/daypaw/web-app'),
    manifest: join(process.cwd(), 'packages/daypaw/web-app/package.json'),
  },
  documentTitle: 'daypaw',
  remote: () => {
    const world = createDaypawRemote()
    return { mock: world.mock, rpc: decorateDurableRpc(world.mock.rpc) }
  },
})

export const installAssembledBootEnv = lane.installAssembledBootEnv
export const mountAssembledApp = lane.mountAssembledApp
export { hasClass, REFRESHING_GOLDEN }
