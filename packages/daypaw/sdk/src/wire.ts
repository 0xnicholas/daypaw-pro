/**
 * The wire face SDK-compiled definitions carry for browser-initiated starts
 * (ruling #65): the input presentation the dialog renders and the opaque
 * validator the engine's `durable/startRun` boundary calls. Installed by
 * {@link bind} and {@link bindAgent} at compile time.
 * @module @daypaw/sdk/wire
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { EngineWireFace, Json } from '@daypaw/engine'

/**
 * Whether one input contract is a starter text shape (ruling #65 §7):
 * `z.string()`, or `z.object({ task: z.string() })`. Dialogs render those as
 * a free-text field; every other shape renders as a JSON box.
 * @param schema - a definition's input contract.
 * @returns whether the shape is one of the two starter text shapes.
 */
function isTextInput(schema: ZodType): boolean {
  if (schema instanceof z.ZodString) return true
  if (!(schema instanceof z.ZodObject)) return false
  const shape = schema.shape as Record<string, ZodType>
  const keys = Object.keys(shape)
  return keys.length === 1 && keys[0] === 'task' && shape.task instanceof z.ZodString
}

/**
 * Compile one definition's wire face.
 * @param input - the definition's input contract.
 * @returns the wire face stamped onto the engine definition record.
 */
export function wireFace(input: ZodType): EngineWireFace {
  return {
    inputKind: isTextInput(input) ? 'text' : 'json',
    parseInput: value => input.parse(value) as Json,
  }
}
