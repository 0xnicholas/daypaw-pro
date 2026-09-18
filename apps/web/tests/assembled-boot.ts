// The upstream web lane's assembled-boot entry: the shared parameterized
// scaffolding (@daypaw/assembled-boot) carrying this lane's options — the
// upstream web-app bundle layer and the fixture Connection transport the page
// self-selects through the `?fixture` search switch. Composition, environment,
// and mount behavior live in the shared module; only the lane options live
// here.
import { join } from 'node:path'
import { createAssembledBootLane, hasClass, REFRESHING_GOLDEN } from '@daypaw/assembled-boot'

const lane = await createAssembledBootLane({
  webBundle: {
    manifest: join(process.cwd(), 'packages/bundle/web-app/package.json'),
    patch: join(process.cwd(), 'packages/bundle/web-app/cordis.patch.yml'),
  },
  documentTitle: 'DeepSeek Harness',
})

export const installAssembledBootEnv = lane.installAssembledBootEnv
export const mountAssembledApp = lane.mountAssembledApp
export { hasClass, REFRESHING_GOLDEN }
