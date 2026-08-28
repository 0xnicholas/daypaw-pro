/**
 * The `daypaw/agents/` directory loader (ruling #65, ADR 0012): each module
 * file under the directory default-exports an injected factory —
 * `export default ({ defineAgent, defineWorkflow, z }) => definition`, or an
 * array of them — and this loader imports every file, calls its factory with
 * the SDK namespace, and binds the produced definitions onto the host's
 * durable engine. Files carry no bare imports: the injected namespace is the
 * whole authoring surface, so a workspace needs no installed SDK copy and
 * the process keeps exactly one engine instance.
 * @module @daypaw/sdk/agents-dir
 */

import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { AgentDefinition } from './agent.ts'
import { bindAgent, defineAgent } from './agent.ts'
import type { WorkflowDefinition } from './index.ts'
import { bind, defineWorkflow } from './index.ts'

/** The namespace injected into every agents-file factory call. */
export type AgentsSdk = {
  /** Declare an agent definition (see `@daypaw/sdk`). */
  readonly defineAgent: typeof defineAgent
  /** Declare a workflow definition (see `@daypaw/sdk`). */
  readonly defineWorkflow: typeof defineWorkflow
  /** zod, for input/output contracts. */
  readonly z: typeof z
}

/** One loaded definition's provenance. */
export interface LoadedDefinition {
  /** Source module file name within the agents directory. */
  readonly file: string
  /** Definition family. */
  readonly kind: 'agent' | 'workflow'
  /** Registry name. */
  readonly name: string
  /** Registry version. */
  readonly version: string
}

/** Module extensions the loader imports; every other entry is ignored. */
const MODULE_EXTENSIONS = new Set(['.mjs', '.js', '.ts'])

/** The namespace every factory receives. */
const SDK: AgentsSdk = { defineAgent, defineWorkflow, z }

/** Narrow a factory's product to a declared definition (module-boundary validation). */
function isDefinition(value: unknown): value is AgentDefinition | WorkflowDefinition {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { kind?: unknown; name?: unknown; version?: unknown }
  return (candidate.kind === 'agent' || candidate.kind === 'workflow')
    && typeof candidate.name === 'string' && candidate.name !== ''
    && typeof candidate.version === 'string' && candidate.version !== ''
}

/** Describe a factory product that failed {@link isDefinition}. */
function describeProduct(value: unknown): string {
  if (value === null || typeof value !== 'object') return `a ${typeof value}`
  const kind = (value as { kind?: unknown }).kind
  return `an object with kind ${String(kind)}`
}

/**
 * Load every agents file in one directory and bind its definitions onto the
 * host's engine. An absent directory is the legal empty roster; a present
 * file that imports badly, exports no factory, throws, or produces a
 * non-definition fails loud naming the file (misconfiguration fails at
 * load). Files load in name order, so registration order — and therefore
 * `durable/listDefinitions` order — is stable across platforms.
 * @param ctx - the host composition (needs `durable`; agent files also need
 * the dsh agent stack `bindAgent` requires).
 * @param dir - agents directory; typically the `daypaw/agents` of the
 * directory the host runs from.
 * @returns the loaded definitions with their source files.
 */
export async function loadAgentFiles(ctx: Context, dir: string): Promise<readonly LoadedDefinition[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const loaded: LoadedDefinition[] = []
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !MODULE_EXTENSIONS.has(extname(entry.name))) continue
    const module = await import(pathToFileURL(join(dir, entry.name)).href)
    const factory = module.default
    if (typeof factory !== 'function') {
      throw new Error(
        `daypaw agents: ${entry.name} default-exports no factory (expected: export default ({ defineAgent, defineWorkflow, z }) => definition)`,
      )
    }
    let produced: unknown
    try {
      produced = await factory(SDK)
    } catch (error) {
      throw new Error(`daypaw agents: ${entry.name} factory failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    const defs = Array.isArray(produced) ? produced : [produced]
    for (const def of defs) {
      if (!isDefinition(def)) {
        throw new Error(`daypaw agents: ${entry.name} produced ${describeProduct(def)}, not a definition`)
      }
      if (def.kind === 'agent') {
        await bindAgent(def, ctx)
      } else {
        const engine = ctx.get('durable')
        if (engine === undefined) {
          throw new Error(`daypaw agents: ${entry.name} declares workflow ${def.name} but the durable engine service is not mounted (mount @daypaw/engine)`)
        }
        await bind(def, engine)
      }
      loaded.push({ file: entry.name, kind: def.kind, name: def.name, version: def.version })
    }
  }
  return loaded
}
