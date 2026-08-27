#!/usr/bin/env node
// The daypaw CLI is the vendored dsh CLI (ADR 0011): seed the daypaw profile
// (the first run materializes it from the shipped template), default the
// launcher's profile to it so a bare `daypaw` boots the product shell, then
// run the dsh bin from the bundled closure. The argv rewrite happens before
// the dynamic import so the dsh bin never sees the raw arguments, and that
// import keeps the dsh bin from evaluating before seeding completes.
import { seedDaypawProfile, withDefaultProfile } from './lib/index.js'

try {
  seedDaypawProfile()
} catch (error) {
  console.error(`daypaw: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

process.argv = [...process.argv.slice(0, 2), ...withDefaultProfile(process.argv.slice(2))]

await import('@deepseek-ai/dsh/lib/bin.js')
