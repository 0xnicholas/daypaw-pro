// The daypaw web lane's assembled-boot entry: the shared parameterized
// scaffolding (@daypaw/assembled-boot) carrying the fork roster (the
// packages/daypaw/web-app layer over the base bundle) and the carrier
// transport — the page installs the connection plugin's override
// (`__DSH_TRANSPORT__`) over the upstream fixture world wrapped with the
// fork's `durable/*` decorator, so the mounted graph rides the same
// ClientRequest/ServerResponse envelope the served web app's HTTP carrier
// uses. Composition, environment, and mount behavior live in the shared
// module; the roster layer, title, and carrier wiring live here.
//
// Keyless and deterministic: the fixture is the fake server, so nothing here
// reaches a model or the network.
import { join } from 'node:path'
import { createFixtureConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { connectionRpcCarrier, createAssembledBootLane, hasClass, REFRESHING_GOLDEN } from '@daypaw/assembled-boot'
import { decorateDurableRpc } from './durable-rpc.ts'

const lane = await createAssembledBootLane({
  webBundle: {
    manifest: join(process.cwd(), 'packages/daypaw/web-app/package.json'),
    patch: join(process.cwd(), 'packages/daypaw/web-app/cordis.patch.yml'),
  },
  documentTitle: 'daypaw',
  carrier: () => connectionRpcCarrier(decorateDurableRpc(createFixtureConnectionRpc())),
})

export const installAssembledBootEnv = lane.installAssembledBootEnv
export const mountAssembledApp = lane.mountAssembledApp
export { hasClass, REFRESHING_GOLDEN }
