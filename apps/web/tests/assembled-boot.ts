// The upstream web lane's assembled-boot entry: the shared parameterized
// scaffolding (@daypaw/assembled-boot) carrying this lane's options — the
// upstream web-app bundle layer and the upstream RemoteMock scenario
// (assembled-remote.ts) as the page's carrier transport. Composition,
// environment, and mount behavior live in the shared module; only the lane
// options live here.
import { join } from 'node:path'
import { createAssembledBootLane, hasClass, REFRESHING_GOLDEN } from '@daypaw/assembled-boot'
import { createAssembledRemote } from './assembled-remote.ts'

const lane = await createAssembledBootLane({
  webBundle: {
    dir: join(process.cwd(), 'packages/bundle/web-app'),
    manifest: join(process.cwd(), 'packages/bundle/web-app/package.json'),
  },
  documentTitle: 'DeepSeek Harness',
  remote: () => createAssembledRemote(),
})

export const installAssembledBootEnv = lane.installAssembledBootEnv
export const mountAssembledApp = lane.mountAssembledApp
export { hasClass, REFRESHING_GOLDEN }
