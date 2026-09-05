/**
 * The `durable/*` Remote failure vocabulary: one closed code set with typed
 * details, shared by the engine (the owner), the SDK wire face, and the
 * shell's consuming client packages. Thrown failures cross the Remote
 * boundary unchanged and consumers discriminate by `error.code`, never by
 * message text. `TypertRemoteFailure` is this tree's wire failure vehicle;
 * when the next upstream sync lands `RemoteError` with the merge-extensible
 * `RemoteErrorDetailsMap` (upstream `804b1ffbfc`), this module's details map
 * becomes that map's `durable/*` declaration and only the carrier class
 * swaps — codes and details stay (ticket #86).
 * @module @daypaw/engine
 */
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'

/** Wire details each `durable/*` failure code carries. */
export interface DurableFailureDetailsMap {
  /** No run row matches the id the caller addressed (steer, rerun, cancel). */
  'durable/run-not-found': { readonly runId: string }
  /** The addressed run is already terminal; steering needs an unfinished run. */
  'durable/run-terminal': { readonly runId: string; readonly status: string }
  /** The addressed run is still unfinished; rerun needs a terminal run. */
  'durable/run-unfinished': { readonly runId: string; readonly status: string }
  /** Rerun targets a child run; only top-level runs carry the attempt chain. */
  'durable/run-is-child': { readonly runId: string }
  /** Start-or-attach hit an existing run id that belongs to a different definition. */
  'durable/run-definition-mismatch': { readonly runId: string }
  /** The run's definition did not opt into steering (`steerable: true`). */
  'durable/run-not-steerable': {
    readonly runId: string
    readonly defKind: string
    readonly defName: string
    readonly defVersion: string
  }
  /** No registered definition matches the caller-named identity. */
  'durable/definition-not-found': { readonly defName: string; readonly defVersion?: string }
  /** The name matches several registered definitions; an exact version must disambiguate. */
  'durable/definition-ambiguous': { readonly defName: string; readonly candidates: readonly string[] }
  /** The run's own definition is absent from this host's registry (rerun). */
  'durable/definition-unregistered': {
    readonly runId: string
    readonly defKind: string
    readonly defName: string
    readonly defVersion: string
  }
  /** The definition's wire contract rejected the input; `issues` lists the violations. */
  'durable/input-invalid': { readonly issues: readonly unknown[] }
  /** steerText needs a definition wire face; this definition carries none. */
  'durable/wire-face-missing': { readonly defName: string; readonly defVersion: string }
  /** The engine's ledger did not open; every durable endpoint fails until it does. */
  'durable/ledger-unavailable': Record<string, never>
}

/** Closed code set of the `durable/*` failure vocabulary. */
export type DurableFailureCode = keyof DurableFailureDetailsMap

/**
 * Build one vocabulary failure for the owner to throw at the failure point.
 * @param code - stable failure code from the closed {@link DurableFailureCode} set.
 * @param message - human diagnostic carried across the wire.
 * @param details - structured payload typed by the code.
 * @returns the wire-carried failure to throw.
 */
export function durableFailure<Code extends DurableFailureCode>(
  code: Code,
  message: string,
  details: DurableFailureDetailsMap[Code],
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}
