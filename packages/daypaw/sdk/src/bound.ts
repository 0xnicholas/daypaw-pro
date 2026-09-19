/**
 * The binding registry: one record per bound definition object, written by
 * `bind` (workflows) and `bindAgent` (agents) and read by the ctx primitives
 * that start another run of a definition — `ctx.agent` (awaited) and
 * `ctx.spawn` (fire-and-forget). An object nothing bound has no record,
 * which is how both primitives fail loud (ADR 0016).
 * @module @daypaw/sdk/bound
 */

import type { ZodType, z } from 'zod'
import type DurableEngine from '@daypaw/engine'
import type { EngineDefinition } from '@daypaw/engine'
import type { RunHandle, RunOptions } from './run-handle.ts'

/** The runnable half of one bound definition. */
export interface BoundRun<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /** Idempotent start-or-attach with the definition's typed IO. */
  readonly run: (input: z.output<I>, opts?: RunOptions) => Promise<RunHandle<z.output<O>, z.output<I>>>
}

/** One bound definition's record: the engine-side facts plus the face the binder returned. */
export interface BoundFace<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /** The engine service the definition is registered on. */
  readonly engine: DurableEngine
  /** The opaque engine record registered under the definition's identity. */
  readonly engineDef: EngineDefinition
  /** The definition's input contract; a primitive validates through it before starting. */
  readonly input: I
  /** The face object `bind`/`bindAgent` returned; a re-bind hands back this same object. */
  readonly face: BoundRun<I, O>
}

const boundFaces = new WeakMap<object, BoundFace>()

/**
 * Record one definition object's binding, replacing any earlier record: a
 * definition object rebound to another engine resolves the newest binding,
 * which is the composition a live body actually runs on. `bindAgent` layers
 * its own first-wins re-bind no-op above this by returning the recorded face
 * before it writes.
 * @param def - the definition object `bind`/`bindAgent` bound.
 * @param face - its engine-side facts and runnable face.
 */
export function registerBoundFace<I extends ZodType, O extends ZodType>(def: object, face: BoundFace<I, O>): void {
  boundFaces.set(def, face)
}

/**
 * @param def - a declared definition object.
 * @returns its binding record, or `undefined` when nothing bound it.
 */
export function boundFaceFor(def: object): BoundFace | undefined {
  return boundFaces.get(def)
}
