import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { normalizeSessionLog } from '@deepseek-ai/dsh-acp-snapshot'
import {
  decompressZstdFrame,
  scanZstdFrames,
} from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'

const mainPath = fileURLToPath(new URL('../src/agent-main.ts', import.meta.url))
const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const happyDir = join(snapshotsDir, 'agent-happy')
const reviveDir = join(snapshotsDir, 'agent-revive')
const steerDir = join(snapshotsDir, 'agent-steer')
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

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
      child.on('exit', (code, signal) => { resolve({ code, signal }) })
    }),
  }
  child.stdout.on('data', (chunk) => { state.stdout += String(chunk) })
  return state
}

async function stage(): Promise<{ root: string; db: string; sessions: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'daypaw-agent-snapshot-'))
  return {
    root,
    db: join(root, 'ledger.db'),
    sessions: join(root, 'sessions'),
    cleanup: () => rm(root, { recursive: true, force: true }),
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

/** Read the one persisted session log under the sessions root. */
async function readSessionLog(sessionsRoot: string): Promise<string> {
  const files = (await readdir(sessionsRoot, { recursive: true }))
    .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  expect(files).toHaveLength(1)
  return readPersistedLog(join(sessionsRoot, files[0]!))
}

/** Wait until the persisted session log contains the marker (the hang entry's partial chunk). */
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

function readRuns(dbPath: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM runs ORDER BY rowid').all()
  } finally {
    db.close()
  }
}

/** Diff the persisted session log (the model-visible surface) against its committed expected output. */
async function expectSessionLog(sessionsRoot: string, expectedPath: string): Promise<string> {
  const normalized = normalizeSessionLog(await readSessionLog(sessionsRoot), {
    sessionIds: [],
    cwd: process.cwd(),
  })
  if (refreshing) await writeFile(expectedPath, normalized)
  expect(normalized).toBe(await readFile(expectedPath, 'utf8'))
  return normalized
}

describe('defineAgent compilation snapshots', () => {
  it('compiles an agent into a durable child run of the workflow', async () => {
    const { db, sessions, cleanup } = await stage()
    try {
      const host = spawnHost([
        '--db', db, '--sessions', sessions,
        '--override', join(happyDir, 'replay.override.json'),
        '--run-id', 'agent-demo-1',
      ])
      const { code } = await host.exit
      expect(code).toBe(0)
      expect(host.stdout).toBe('{"verdict":42}\n')

      // The whole model-visible surface of the compiled agent is pinned by the
      // persisted session log: the persona prompt section text, the injected
      // `submit` tool schema, and the input message.
      const log = await expectSessionLog(sessions, join(happyDir, 'session.expected.jsonl'))
      expect(log).toContain('You review code and report a numeric score from 0 to 100.')
      expect(log).toContain('"name":"submit"')
      expect(log).toContain('Submission accepted; the run is complete.')

      const rows = readRuns(db)
      expect(rows.map(row => row.run_id)).toEqual([
        'agent-demo-1',
        'agent-demo-1/agent:reviewer#0/agent:reviewer#0',
      ])
      expect(rows[1]?.parent_run_id).toBe('agent-demo-1')
      expect(rows[1]?.parent_step_key).toBe('agent:reviewer#0')
      expect(rows.every(row => row.status === 'done')).toBe(true)
    } finally {
      await cleanup()
    }
  }, 60_000)

  it('revives a SIGKILLed agent run with a synthetic continuation steer', async () => {
    const { db, sessions, cleanup } = await stage()
    try {
      const first = spawnHost([
        '--db', db, '--sessions', sessions,
        '--override', join(reviveDir, 'replay.hang.override.json'),
        '--run-id', 'agent-revive-1',
        '--hold-open',
      ])
      // The hang entry's partial chunk must be durable before the kill.
      await untilSessionContains(sessions, 'partial')
      await new Promise(resolve => setTimeout(resolve, 100))
      process.kill(first.pid, 'SIGKILL')
      await first.exit

      const restart = spawnHost([
        '--db', db, '--sessions', sessions,
        '--override', join(reviveDir, 'replay.resume.override.json'),
        '--run-id', 'agent-revive-1',
      ])
      const { code } = await restart.exit
      expect(code).toBe(0)
      expect(restart.stdout).toBe('{"verdict":7}\n')

      // The revived session's log pins the synthetic resume steer the model sees.
      const log = await expectSessionLog(sessions, join(reviveDir, 'session.expected.jsonl'))
      expect(log).toContain('The host process restarted')
      expect(log).toContain('REVIEW RESUMED')

      const rows = readRuns(db)
      expect(rows.every(row => row.status === 'done')).toBe(true)
    } finally {
      await cleanup()
    }
  }, 60_000)

  it('pins the multi-segment model-visible surface of a steered run', async () => {
    const { db, sessions, cleanup } = await stage()
    try {
      // The steer lands right after start; the run consumes the segment at the
      // segment boundary — after turn 1 quiesces without submit.
      const host = spawnHost([
        '--db', db, '--sessions', sessions,
        '--override', join(steerDir, 'replay.override.json'),
        '--run-id', 'agent-steer-1',
        '--mode', 'steer',
        '--steer', '{"code":"export const extra = 1"}',
      ])
      const { code } = await host.exit
      expect(code).toBe(0)
      expect(host.stdout).toBe('{"score":63}\n')

      // One session log carries both user messages: the initial input and the
      // steered follow-up, with no synthetic resume steer in between.
      const log = await expectSessionLog(sessions, join(steerDir, 'session.expected.jsonl'))
      expect(log).toContain('You review code iteratively and report a numeric score from 0 to 100 once the review is complete.')
      expect(log).toContain('export const answer = 42')
      expect(log).toContain('export const extra = 1')
      expect(log).not.toContain('The host process restarted')

      const rows = readRuns(db)
      expect(rows.map(row => row.run_id)).toEqual(['agent-steer-1'])
      expect(rows.every(row => row.status === 'done')).toBe(true)
    } finally {
      await cleanup()
    }
  }, 60_000)
})
