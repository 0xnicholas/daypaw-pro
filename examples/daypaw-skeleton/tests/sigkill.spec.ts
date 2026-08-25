import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {
  decompressZstdFrame,
  scanZstdFrames,
} from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'

const mainPath = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const agentMainPath = fileURLToPath(new URL('../src/agent-main.ts', import.meta.url))
const steerDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots', 'agent-steer')

interface Host {
  stdout: string
  pid: number
  exit: Promise<{ code: number | null; signal: string | null }>
}

function spawnHost(args: string[], entry = mainPath): Host {
  const child = spawn(process.execPath, ['--import', 'tsx/esm', entry, ...args], {
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

function journalRows(dbPath: string, runId: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM journal WHERE run_id = ? ORDER BY rowid').all(runId)
  } finally {
    db.close()
  }
}

/** Decode one persisted log file, plain JSONL or Zstandard-framed. */
async function readPersistedLog(file: string): Promise<string> {
  const content = await readFile(file)
  if (!file.endsWith('.zstd')) return content.toString('utf8')
  const scan = scanZstdFrames(content)
  if (scan.tornStart !== undefined) throw new Error(`persisted snapshot log has a torn Zstandard frame: ${file}`)
  const decoded: Buffer[] = []
  for (const frame of scan.frames) {
    decoded.push(await decompressZstdFrame(content.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(decoded).toString('utf8')
}

/** Wait until a persisted session log under the root contains the marker. */
async function untilSessionContains(sessionsRoot: string, marker: string): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    let files: string[] = []
    try {
      files = (await readdir(sessionsRoot, { recursive: true }))
        .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const file of files) {
      try {
        if ((await readPersistedLog(join(sessionsRoot, file))).includes(marker)) return
      } catch {
        // A mid-write Zstandard log can end in a torn frame; retry next poll.
      }
    }
    if (Date.now() > deadline) throw new Error(`session log never contained ${JSON.stringify(marker)}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function stage(): Promise<{ db: string; effects: string; sessions: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'daypaw-sigkill-'))
  return {
    db: join(root, 'ledger.db'),
    effects: join(root, 'effects.log'),
    sessions: join(root, 'sessions'),
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

describe('steerable agent run under a real SIGKILL', () => {
  it('revives a run killed while parked and completes it from the steered segment', async () => {
    const { db, sessions, cleanup } = await stage()
    try {
      // Turn 1 ends without submit, so the steerable run parks at zero compute
      // instead of failing; --hold-open keeps the host alive until the kill.
      const first = spawnHost([
        '--db', db, '--sessions', sessions,
        '--override', join(steerDir, 'replay.park.override.json'),
        '--run-id', 'sig-steer-1', '--mode', 'steer', '--hold-open',
      ], agentMainPath)
      // The persisted turn/end proves turn 1 quiesced; give the park (journal
      // write plus steer wait) a moment to settle before the kill, so the
      // revival provably re-parks rather than resuming a turn.
      await untilSessionContains(sessions, '"turn/end"')
      await new Promise(resolve => setTimeout(resolve, 100))
      process.kill(first.pid, 'SIGKILL')
      await first.exit

      const restart = spawnHost([
        '--db', db, '--sessions', sessions,
        '--override', join(steerDir, 'replay.resume.override.json'),
        '--run-id', 'sig-steer-1', '--mode', 'steer',
        '--steer', '{"code":"export const extra = 1"}',
      ], agentMainPath)
      const { code } = await restart.exit
      expect(code).toBe(0)
      expect(JSON.parse(restart.stdout)).toEqual({ score: 63 })

      const row = runRowOf(db, 'sig-steer-1')
      expect(row.status).toBe('done')
      expect(JSON.parse(row.output_json as string)).toEqual({ score: 63 })

      const journal = journalRows(db, 'sig-steer-1')
      const segment = journal.find(step => step.kind === 'segment')
      expect(segment?.step_key).toBe('steer:1')
      expect(JSON.parse(segment?.value_json as string)).toEqual({ code: 'export const extra = 1' })
    } finally {
      await cleanup()
    }
  }, 60_000)
})
