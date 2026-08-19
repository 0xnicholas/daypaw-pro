import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const mainPath = fileURLToPath(new URL('../src/main.ts', import.meta.url))

interface Host {
  stdout: string
  pid: number
  exit: Promise<{ code: number | null; signal: string | null }>
}

function spawnHost(args: string[]): Host {
  const child = spawn(process.execPath, ['--import', 'tsx/esm', mainPath, ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const state: Host = {
    stdout: '',
    pid: child.pid!,
    exit: new Promise((resolve) => {
      child.on('exit', (code, signal) =>{  resolve({ code, signal }) })
    }),
  }
  child.stdout.on('data', (chunk) => { state.stdout += String(chunk) })
  return state
}

async function untilEffectsContain(effectsPath: string, name: string): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      const lines = (await readFile(effectsPath, 'utf8')).split('\n').filter(line => line !== '')
      if (lines.includes(name)) return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (Date.now() > deadline) throw new Error(`effects file never recorded "${name}"`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function effectCounts(effectsPath: string): Promise<Record<string, number>> {
  const lines = (await readFile(effectsPath, 'utf8')).split('\n').filter(line => line !== '')
  const counts: Record<string, number> = {}
  for (const line of lines) counts[line] = (counts[line] ?? 0) + 1
  return counts
}

function runRowOf(dbPath: string, runId: string): Record<string, unknown> {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined
    expect(row).toBeDefined()
    return row!
  } finally {
    db.close()
  }
}

async function stage(): Promise<{ db: string; effects: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'daypaw-sigkill-'))
  return {
    db: join(root, 'ledger.db'),
    effects: join(root, 'effects.log'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

describe('walking skeleton under a real SIGKILL', () => {
  it('revives a killed run via boot scan with completed steps not re-executed', async () => {
    const { db, effects, cleanup } = await stage()
    try {
      const first = spawnHost(['--db', db, '--effects', effects, '--run-id', 'sig-1', '--step-delay-ms', '300'])
      await untilEffectsContain(effects, 'first')
      // Let the step's completed-journal write (a microtask after the effect
      // line lands) commit before the kill, so "first" is provably recorded.
      await new Promise(resolve => setTimeout(resolve, 50))
      process.kill(first.pid, 'SIGKILL')
      await first.exit

      const countsMidKill = await effectCounts(effects)
      expect(countsMidKill.third ?? 0).toBe(0)

      const restart = spawnHost(['--db', db, '--effects', effects])
      const { code } = await restart.exit
      expect(code).toBe(0)
      expect(JSON.parse(restart.stdout)).toEqual({ revived: true })

      const counts = await effectCounts(effects)
      expect(counts.first).toBe(1)
      expect(counts.second).toBeGreaterThanOrEqual(1)
      expect(counts.third).toBe(1)

      const row = runRowOf(db, 'sig-1')
      expect(row.status).toBe('done')
      expect(JSON.parse(row.output_json as string)).toEqual({ total: 4 })
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('attaches to a killed run by runId and prints the typed result', async () => {
    const { db, effects, cleanup } = await stage()
    try {
      const first = spawnHost(['--db', db, '--effects', effects, '--run-id', 'sig-2', '--step-delay-ms', '300'])
      await untilEffectsContain(effects, 'first')
      // Let the step's completed-journal write (a microtask after the effect
      // line lands) commit before the kill, so "first" is provably recorded.
      await new Promise(resolve => setTimeout(resolve, 50))
      process.kill(first.pid, 'SIGKILL')
      await first.exit

      const restart = spawnHost(['--db', db, '--effects', effects, '--run-id', 'sig-2'])
      const { code } = await restart.exit
      expect(code).toBe(0)
      expect(JSON.parse(restart.stdout)).toEqual({ total: 4 })

      const counts = await effectCounts(effects)
      expect(counts.first).toBe(1)
      expect(counts.third).toBe(1)

      const row = runRowOf(db, 'sig-2')
      expect(row.status).toBe('done')
      expect(JSON.parse(row.output_json as string)).toEqual({ total: 4 })
    } finally {
      await cleanup()
    }
  }, 30_000)
})
