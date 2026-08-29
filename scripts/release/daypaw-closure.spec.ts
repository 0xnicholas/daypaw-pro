/** Closure restore for the daypaw release staging trees: fixpoint completion, loud failures. */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { completeClosure, missingClosurePackages } from './daypaw-closure.ts'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Fixture {
  /** Throwaway repository root; doubles as the resolution base for locatePackage. */
  root: string
  /** The edit-safe staging tree under test. */
  staging: string
  /** The deploy root's repository directory holding hoist residue sources. */
  sourceDir: string
}

function fixture(rootDependencies: Record<string, string>): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'daypaw-closure-'))
  fixtureRoots.push(root)
  const staging = join(root, 'staging')
  const sourceDir = join(root, 'source')
  mkdirSync(join(staging, 'node_modules'), { recursive: true })
  mkdirSync(join(sourceDir, 'node_modules'), { recursive: true })
  writeFileSync(join(staging, 'package.json'), `${JSON.stringify({ name: 'probe', dependencies: rootDependencies }, null, 2)}\n`)
  return { root, staging, sourceDir }
}

/**
 * Stage one source package in the deploy residue.
 * @param fix - the fixture receiving the package.
 * @param name - the package name.
 * @param dependencies - its runtime dependencies.
 */
function sourcePackage(fix: Fixture, name: string, dependencies: Record<string, string> = {}): void {
  const dir = join(fix.sourceDir, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, version: '1.0.0', dependencies }, null, 2)}\n`)
}

describe('completeClosure', () => {
  it('completes a dependency chain deeper than any fixed restore-round budget', async () => {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const fix = fixture({ a: '*' })
    letters.forEach((letter, index) => {
      const next = letters[index + 1]
      sourcePackage(fix, letter, next === undefined ? {} : { [next]: '*' })
    })

    await completeClosure(fix.staging, fix.sourceDir, [], fix.root)

    for (const letter of letters) {
      expect(existsSync(join(fix.staging, 'node_modules', letter, 'package.json')), letter).toBe(true)
    }
  })

  it('resolves immediately when the staged closure is already complete', async () => {
    const fix = fixture({ a: '*' })
    sourcePackage(fix, 'a')
    const staged = join(fix.staging, 'node_modules', 'a')
    mkdirSync(staged, { recursive: true })
    writeFileSync(join(staged, 'package.json'), `${JSON.stringify({ name: 'a', version: '1.0.0' }, null, 2)}\n`)

    await expect(completeClosure(fix.staging, fix.sourceDir, [], fix.root)).resolves.toBeUndefined()
  })

  it('fails loud naming a package with no repository source', async () => {
    const fix = fixture({ ghost: '*' })

    await expect(completeClosure(fix.staging, fix.sourceDir, [], fix.root))
      .rejects.toThrow(/ghost.*has no repository source/s)
  })

  it('credits a staged package by its staged directory even when the residue manifest declares another name', async () => {
    const fix = fixture({ impostor: '*' })
    // The source directory exists, so restore stages it under the requested
    // name; Node resolves by directory, so the manifest's own name field does
    // not affect resolution and the closure completes.
    sourcePackage(fix, 'impostor')
    writeFileSync(
      join(fix.sourceDir, 'node_modules', 'impostor', 'package.json'),
      `${JSON.stringify({ name: 'not-impostor', version: '1.0.0' }, null, 2)}\n`,
    )

    await expect(completeClosure(fix.staging, fix.sourceDir, [], fix.root)).resolves.toBeUndefined()
    expect(existsSync(join(fix.staging, 'node_modules', 'impostor', 'package.json'))).toBe(true)
  })
})

describe('missingClosurePackages', () => {
  it('allows absent optional and consumer-supplied external peers, reports hard peers', async () => {
    const fix = fixture({})
    writeFileSync(
      join(fix.staging, 'package.json'),
      `${JSON.stringify({
        name: 'probe',
        peerDependencies: { opt: '*', ext: '*', hard: '*' },
        peerDependenciesMeta: { opt: { optional: true } },
      }, null, 2)}\n`,
    )

    await expect(missingClosurePackages(fix.staging, ['ext'])).resolves.toEqual(['hard'])
  })
})
