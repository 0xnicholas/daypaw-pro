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
 * Which starter text shape one input contract is (ruling #65 §7):
 * `z.string()`, `z.object({ task: z.string() })`, or neither. Dialogs render
 * both starter shapes as one free-text field and hand the bare string; the
 * `{ task }` shape differs only in the value the contract expects, which the
 * wire face owns — the dialog never learns the shape.
 */
type TextInput = 'plain' | 'task'

/**
 * Classify one input contract's starter text shape.
 * @param schema - a definition's input contract.
 * @returns the starter shape, or undefined for every other shape.
 */
function textShapeOf(schema: ZodType): TextInput | undefined {
  if (schema instanceof z.ZodString) return 'plain'
  if (!(schema instanceof z.ZodObject)) return undefined
  const shape = schema.shape as Record<string, ZodType>
  const keys = Object.keys(shape)
  return keys.length === 1 && keys[0] === 'task' && shape.task instanceof z.ZodString ? 'task' : undefined
}

/**
 * Compile one definition's wire face.
 * @param input - the definition's input contract.
 * @returns the wire face stamped onto the engine definition record.
 */
export function wireFace(input: ZodType): EngineWireFace {
  const textShape = textShapeOf(input)
  return {
    inputKind: textShape === undefined ? 'json' : 'text',
    parseInput: value => input.parse(textShape === 'task' && typeof value === 'string' ? { task: value } : value) as Json,
  }
}
