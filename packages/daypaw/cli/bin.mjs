#!/usr/bin/env node
// The daypaw CLI is the vendored dsh CLI (ADR 0011): seed the daypaw profile
// (the first run materializes it from the shipped template), then boot the dsh
// bin from the bundled closure. The dynamic import keeps the dsh bin from
// evaluating before seeding completes.
import { seedDaypawProfile } from './lib/index.js'

try {
  seedDaypawProfile()
} catch (error) {
  console.error(`daypaw: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

await import('@deepseek-ai/dsh/lib/bin.js')
