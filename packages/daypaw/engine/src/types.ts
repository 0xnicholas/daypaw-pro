/**
 * Wire-facing read models of the durable engine's definition registry
 * (spec 05 §5): the public non-root type subpath the Typert Remote boundary
 * imports from. Kept free of runtime code so the remote client can depend on
 * the types alone.
 * @module @daypaw/engine/types
 */

import type { RunDefKind } from '@daypaw/store'

/** Display metadata a definition declares for host catalog views (spec 05 §5). */
export interface DefinitionDisplay {
  /** Business-facing name. */
  readonly title: string
  /** Business-facing description. */
  readonly description: string
}

/**
 * Read-only registry entry returned by `listDefinitions`: identity and
 * display metadata, never the body.
 */
export interface DefinitionView {
  /** Definition family. */
  readonly kind: RunDefKind
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Declared display metadata; the key is absent when the definition declares none (wire-safe: no undefined values). */
  readonly display?: DefinitionDisplay
}

/**
 * JSON value at a Typert Remote boundary: the wire carries JSON, so `unknown`
 * is not a legal Remote parameter — `steer`'s follow-up input arrives as
 * `Json` and is validated against the definition's contract by the SDK face.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

// The query-surface Remote boundary (spec 05 §5): `listRuns`'s filter and the
// row/read types all three query endpoints plus `rerun` share. Re-exported
// here because the Typert generator requires Remote boundary types on this
// public non-root subpath; the declarations stay owned by the store and core.
export type { RunDefKind, JournalKindDb, JournalRow, JournalStatusDb, RunRow, RunStatusDb } from '@daypaw/store/types'
export type { RunListFilter } from './seams.ts'
export type { RunLineage } from './core.ts'
