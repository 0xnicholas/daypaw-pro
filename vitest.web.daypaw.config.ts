import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// daypaw fork web lane: the assembled fork roster (apps/daypaw-web/tests)
// booted from built bundles against the keyless fixture transport. Replay
// compares committed goldens; record/refresh remain explicit local workflows
// (DSH_SNAPSHOT=record|refresh), same as the upstream web lane.
export default defineConfig({
  // Same resolution note as vitest.config.ts: the tsconfig.base.json paths
  // facade has no include (match-all), so apps/daypaw-web/tests resolves bare
  // workspace imports to source like every other lane.
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    execArgv: vitestExecArgv,
    include: [
      // The .snapshot.ts suffix is reserved repo-wide for recorded-session
      // adapters (scripts/session-snapshot-corpus.corpus.ts); this lane's
      // golden replays are owner-local expected outputs and use .golden.ts.
      'apps/daypaw-web/tests/**/*.golden.ts',
    ],
    // Browser boot is slow; files share one browser, run serial.
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
