// PROTOTYPE stubs — local stand-ins so `tsc --noEmit` runs without pnpm install.
// Shapes COPIED FROM upstream source (verified 2026-08-16, branch prototype/sdk-api-surface);
// trimmed to what this draft touches. Real fork import replaces these.

declare module 'zod' {
  export type ZodType<T = unknown> = { readonly _output: T }
  export const z: {
    string(): ZodType<string>
    number(): ZodType<number>
    boolean(): ZodType<boolean>
    literal<T extends string | number | boolean>(v: T): ZodType<T>
    optional<T extends ZodType<any>>(t: T): ZodType<T['_output'] | undefined>
    array<T extends ZodType<any>>(t: T): ZodType<T['_output'][]>
    union<T extends readonly ZodType<any>[]>(ts: T): ZodType<T[number]['_output']>
    object<S extends Record<string, ZodType<any>>>(shape: S): ZodType<{ [K in keyof S]: S[K]['_output'] }>
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolRunContext {
    readonly signal: AbortSignal
    readonly callId: string
  }
  /** Trimmed from upstream ToolDefinition (packages/core/tools/src/index.ts:222). */
  export interface ToolDefinition {
    readonly name: string
    readonly description: string
    readonly parameters: unknown
    readonly output: { readonly schema: unknown }
    readonly timeoutMs?: number
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  }
  /** Loose stand-in for upstream defineTool (typed inference trimmed). */
  export function defineTool(options: {
    readonly name: string
    readonly description: string
    readonly parameters?: unknown
    readonly output?: { readonly schema?: unknown }
    readonly timeoutMs?: number
    execute(args: any, exec: ToolRunContext): Promise<any>
  }): ToolDefinition
}

declare module '@deepseek-ai/dsh-system-prompt' {
  /** Upstream PromptSection (packages/core/system-prompt/src/index.ts:53). */
  export interface PromptSection {
    readonly name: string
    readonly order: number
    readonly text: string | ((context: unknown) => string)
  }
}
