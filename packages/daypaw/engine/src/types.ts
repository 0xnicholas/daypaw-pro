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
