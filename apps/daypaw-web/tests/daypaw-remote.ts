// The daypaw fork's keyless world on `RemoteMock` (ADR 0018): the endpoint
// rules and stream scripts the ten golden lanes' facts live on — the fx
// session world (fx-alpha's 76-turn history with the approval pairs, the
// turn-75 todo sample, and the open blocked call, fx-beta's child row,
// fx-gamma's resident question), the `$events` waterfalls, the control
// baseline with every projection value, and the prompt echo generator whose
// assistant growth frames and `turn/end` the conversation lanes pin. The
// seed facts and projection folds move from the retired browser fixture;
// `durable/*` stays on the decorator transport (`durable-rpc.ts`), which
// wraps this mock's `rpc`.
//
// Keyless and deterministic: the mock is the fake server, so nothing here
// reaches a model or the network. Lanes pin `Date` before mount, so every
// `Date.now()` below lands on the pinned clock.
import { randomUUID } from 'node:crypto'
import { ok, RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { remoteDefaultResponses } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import {
  AssistantStreamAccumulator,
  expandAssistantStream,
  type AssistantStreamRecord,
} from '@deepseek-ai/dsh-llm/assistant-stream'
import type {
  AssistantMessage,
  ContentBlock,
  MessageSource,
  StreamChunk,
  TokenUsage,
  ToolResultMessage,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { SESSION_FORMAT_VERSION, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { deriveEventMessage, foldSurface, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { CommandDefinitionId, CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandDescriptor, CommandExecution, CommandResult } from '@deepseek-ai/dsh-commands/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'

// ---------------------------------------------------------------------------
// Wire types (local mirrors of the host contracts this world serves)
// ---------------------------------------------------------------------------

/** The V3-era context-injection attribution, retained verbatim on the wire (upstream's migrated
 * fixture JSON carries the same record); the V4 source union dropped the catch-all `plugin` kind. */
const LEGACY_FIXTURE_SOURCE = { kind: 'plugin', plugin: 'fixture' } as unknown as Parameters<typeof userMessage>[1]

interface SessionSummary {
  readonly sessionId: SessionId
  updatedAt: number
  running: boolean
  blank: boolean
  readonly parentSessionId?: SessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly agentPreset?: string
}

interface ProjectionsBlock {
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, unknown>>
}

interface HistoryEntry {
  readonly type: 'event'
  readonly event: SessionEvent
}

interface SessionAddress {
  readonly kind: 'session'
  readonly sessionId: SessionId
}

interface PageRequest {
  readonly address: SessionAddress
  readonly throughSeq: number
  readonly beforeSeq?: number
  readonly maxMessages?: number
  readonly turnWindow?: { readonly minMessages: number; readonly minTurns: number }
}

interface SessionWireHeader {
  readonly version: number
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
}

type AssistantStreamFrame =
  | {
    readonly type: 'start'
    readonly attemptId: ReturnType<typeof LlmAttemptId>
    readonly revision: number
    readonly startedAfterSeq: number
    readonly turn: number
    readonly step: number
  }
  | {
    readonly type: 'chunk'
    readonly attemptId: ReturnType<typeof LlmAttemptId>
    readonly revision: number
    readonly index: number
    readonly time: number
    readonly chunk: unknown
  }
  | {
    readonly type: 'end'
    readonly attemptId: ReturnType<typeof LlmAttemptId>
    readonly revision: number
    readonly index: number
    readonly outcome:
      | {
        readonly kind: 'committed'
        readonly eventType: 'assistant/message' | 'assistant/attempt'
        readonly seq: number
      }
      | { readonly kind: 'abandoned' }
  }

interface AssistantStreamBaseline {
  readonly revision: number
  readonly activeAttempt?: {
    readonly attemptId: ReturnType<typeof LlmAttemptId>
    readonly startedAfterSeq: number
    readonly turn: number
    readonly step: number
    readonly nextIndex: number
    readonly stream: readonly AssistantStreamRecord[]
  }
}

interface RemoteEventNotificationFrame {
  readonly type: 'emit'
  readonly event: string
  readonly args: readonly unknown[]
}

interface RemoteEventInvocationFrame {
  readonly type: 'waterfall'
  readonly event: string
  readonly eventId: string
  readonly agentId: SessionId
  readonly request: Readonly<Record<string, unknown>>
}

interface RemoteEventCancellationFrame {
  readonly type: 'cancel'
  readonly eventId: string
}

interface RemoteEventResult {
  readonly clientId: string
  readonly eventId: string
  readonly outcome:
    | { readonly kind: 'next' }
    | { readonly kind: 'result'; readonly value?: unknown }
    | {
      readonly kind: 'rejected'
      readonly error: { readonly name: string; readonly message: string; readonly code?: string; readonly details?: unknown }
    }
}

interface ProjectionFrame {
  readonly type: 'projection'
  readonly sessionId: SessionId
  readonly key: string
  readonly value: unknown
  readonly seq: number
}

interface QuestionItem {
  readonly id: string
  readonly header?: string
  readonly question: string
  readonly detail?: string
  readonly multiSelect?: boolean
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
}

type ControlFrame =
  | {
    readonly type: 'baseline'
    readonly value: {
      readonly queues: Readonly<Record<string, readonly never[]>>
      readonly jobs: Readonly<Record<string, readonly never[]>>
      readonly approvals: readonly never[]
      readonly questions: readonly never[]
      readonly projections: Readonly<Record<string, ProjectionsBlock>>
    }
  }
  | ProjectionFrame

type PromptPart =
  | { readonly type: 'text'; readonly text: string }
  | {
    readonly type: 'image'
    readonly mediaType: ImageAttachmentRef['mediaType']
    readonly data: string
    readonly name?: string
  }

interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly reasoning?: {
      readonly efforts: readonly { readonly id: string; readonly name: string; readonly description?: string }[]
      readonly defaultEffort?: string
    }
  }[]
}

interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  sessionIds: SessionId[]
  readonly createdAt: string
  updatedAt: string
}

type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: { readonly items: readonly WorkspaceView[]; readonly archivedSessionIds: readonly SessionId[]; readonly pinnedSessionIds: readonly SessionId[] } }
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }

// ---------------------------------------------------------------------------
// Message helpers and content seeds (moved from the retired browser fixture)
// ---------------------------------------------------------------------------

function sid(id: string): SessionId {
  return id as SessionId
}

function text(t: string): ContentBlock[] {
  return [{ type: 'text', text: t }]
}

function userMessage(content: ContentBlock[], source: MessageSource = { kind: 'user' }): UserMessage {
  return createUserMessage({ content, source })
}

function assistantMessage(content: ContentBlock[], model = 'fx-1'): AssistantMessage {
  return createAssistantMessage({
    content,
    source: { provider: 'fixture', model },
  })
}

function toolResultMessage(callId: string, content: ContentBlock[], isError: boolean): ToolResultMessage {
  return createToolResultMessage({ callId: brandString<ToolCallId>(callId), content, isError })
}

const MARKDOWN_FIXTURE = [
  '# Markdown fixture',
  '',
  'Assistant output renders **strong text**, *emphasis*, and `inline code`.',
  '',
  '- first item',
  '  - nested item',
  '',
  '| Area | State |',
  '| --- | --- |',
  '| history | rendered |',
  '| streaming | stable |',
  '',
  '[DeepSeek](https://www.deepseek.com)',
  '',
  '```ts',
  'const markdown = true',
  '```',
].join('\n')

const USER_MARKDOWN_LITERAL = '用户字面量：# 不渲染 `code` [link](https://example.com)'

/**
 * SGR wrapper for the terminal output sample below: authoring the escapes as
 * `\u001b` keeps literal control bytes out of this source file.
 * @param code - the SGR parameter (an ANSI color or attribute number).
 * @param body - the text the attribute applies to.
 * @returns the body wrapped in the attribute and a reset.
 */
function sgr(code: number, body: string): string {
  return `\u001b[${code}m${body}\u001b[0m`
}

/**
 * Terminal output sample for fx-alpha turn 66, authored to carry every feature
 * the terminal card draws that turn 60's two prompt rows cannot reach:
 * basic-16 SGR runs, a bold run, column-aligned table rows, and more than
 * DEFAULT_TERMINAL_MAX_LINES (16) lines so the height cap collapses the middle.
 */
const TERMINAL_OUTPUT_FIXTURE = [
  sgr(1, 'Running 4 checks'),
  `${sgr(32, '\u2713')} typecheck                                          1.82s`,
  `${sgr(32, '\u2713')} lint                                               0.94s`,
  `${sgr(32, '\u2713')} duplication                                        2.10s`,
  `${sgr(31, '\u2717')} unit                                               8.41s`,
  '',
  sgr(90, 'packages/client/ui-primitives/tests/terminal-block.client.spec.tsx'),
  `  ${sgr(31, 'FAIL')} caps output at the configured line budget`,
  '    expected 16 lines, received 24',
  '',
  'NAME                        LINES    BRANCHES    FUNCTIONS    UNCOVERED',
  'TerminalBlock.tsx           100%     100%        100%         -',
  'ansi.ts                     100%     100%        100%         -',
  'clipboard.ts                100%     100%        100%         -',
  'CodeBlock.tsx               98.4%    96.2%       100%         41-43',
  'highlight.ts                100%     100%        100%         -',
  'Pill.tsx                    100%     100%        100%         -',
  'StateDot.tsx                100%     100%        100%         -',
  'markdown/Markdown.tsx       100%     100%        100%         -',
  '',
  sgr(31, '1 of 4 checks failed'),
].join('\n')

/** Structured grep metadata for the search sample (turn 67). */
const SEARCH_MATCHES_FIXTURE: { path: string; matches: { lineNumber: number; line: string }[] }[] = [
  {
    path: 'packages/client/ui-primitives/src/SearchBlock.tsx',
    matches: [
      { lineNumber: 16, line: 'export const DEFAULT_SEARCH_MAX_LINES = 16' },
      { lineNumber: 138, line: 'export function SearchBlock(props: SearchBlockProps) {' },
      { lineNumber: 141, line: '  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())' },
    ],
  },
  {
    path: 'packages/client/ui-tool/src/client/tool/models/search-card-model.ts',
    matches: [
      { lineNumber: 45, line: 'export const CHAT_SEARCH_MAX_LINES = 8' },
      { lineNumber: 130, line: 'export function searchCardModel(block: ToolCallBlock): SearchCardModel | null {' },
    ],
  },
  {
    path: 'packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx',
    matches: [
      { lineNumber: 34, line: 'export function SearchRow({ toolName, block, inspect, t }: SearchRowProps) {' },
      { lineNumber: 36, line: '  const search = searchCardModel(block)' },
      { lineNumber: 56, line: '      search={search}' },
      { lineNumber: 78, line: "      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow)" },
    ],
  },
]

const SEARCH_MATCHES_TEXT = [
  'Found 9 of 42 matches',
  '',
  ...SEARCH_MATCHES_FIXTURE.map(file =>
    [file.path, ...file.matches.map(m => `Line ${m.lineNumber}: ${m.line}`)].join('\n')),
  '',
  '(Full grep result stored at: fixture://spill/grep-66. Read it to see every match.)',
].join('\n')

const SEARCH_PATHS_FIXTURE = [
  'packages/client/ui-primitives/src/SearchBlock.tsx',
  'packages/client/ui-primitives/src/SearchBlock.module.css',
  'packages/client/ui-tool/src/client/tool/models/search-card-model.ts',
  'packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx',
  'packages/client/ui-tool/tests/search-card.client.spec.tsx',
]

const SEARCH_PATHS_TEXT = [
  ...SEARCH_PATHS_FIXTURE,
  '',
  '(Showing 5 of 23 paths. Full sorted result stored at: fixture://spill/glob-67. Read it to see every path.)',
].join('\n')

const READ_SAMPLE_FIRST_LINE = 41
const READ_SAMPLE_SOURCE = [
  'export interface ReadBlockProps {',
  '  label?: string | undefined',
  '  lines: readonly ReadBlockLine[]',
  '  totalLines: number',
  '  lang?: string | undefined',
  '  maxLines?: number | undefined',
  '  className?: string | undefined',
  '}',
  '',
  '// A windowed read keeps the file line numbers in the gutter.',
  'const marker = "fixture read sample"',
]
const READ_SAMPLE_LINES = READ_SAMPLE_SOURCE.map((line, index) => ({ number: READ_SAMPLE_FIRST_LINE + index, text: line }))
const READ_SAMPLE_PATH = 'packages/client/ui-primitives/src/ReadBlock.tsx'
const READ_SAMPLE_TOTAL = 180
const READ_SAMPLE_LAST_LINE = READ_SAMPLE_FIRST_LINE + READ_SAMPLE_SOURCE.length - 1
const READ_SAMPLE_TEXT = [
  `<path>${READ_SAMPLE_PATH}</path>`,
  '<type>file</type>',
  '<content>',
  ...READ_SAMPLE_SOURCE.map((line, index) => `${READ_SAMPLE_FIRST_LINE + index}: ${line}`),
  '',
  `(Showing lines ${READ_SAMPLE_FIRST_LINE}-${READ_SAMPLE_LAST_LINE} of ${READ_SAMPLE_TOTAL}. Use offset=${READ_SAMPLE_LAST_LINE + 1} to continue.)`,
  '</content>',
].join('\n')

/** The `web_search` result metadata for the web-search turn (turn 70). */
const WEB_SEARCH_META = {
  answer: 'DeepSeek Harness is a plugin-based agent harness on vendored Cordis where **every capability is a plugin**.',
  sources: [
    {
      url: 'https://github.com/deepseek-ai/deepseek-harness',
      title: 'DeepSeek Harness — plugin-based agent harness',
      snippet: 'Everything is a plugin: session, tools, agent-loop, and LLM adapters all mount on the same Cordis context.',
      publishedAt: '2026-07-01',
    },
    {
      url: 'https://www.deepseek.com/blog/harness-architecture',
      snippet: 'The capability-seam pattern splits each capability into interface, implementation, and consumer packages.',
    },
    {
      url: 'https://docs.deepseek.com/harness/plugins',
      title: 'Writing a harness plugin',
      publishedAt: '2026-06-15',
    },
  ],
  truncated: true,
}

/** The `web_fetch` result metadata for the web-fetch turn (turn 71). */
const WEB_FETCH_META = {
  url: 'https://www.deepseek.com/blog/harness-architecture',
  statusCode: 200,
  truncated: false,
}

const DEEPSEEK_REASONING = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
}

const OPENAI_REASONING = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'medium',
}

/** Catalog served by `session/modelCatalog`. */
function fixtureModelGroups(): ModelProviderGroup[] {
  return [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', description: '快速响应', reasoning: DEEPSEEK_REASONING },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: '复杂任务', reasoning: DEEPSEEK_REASONING },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt-5', name: 'GPT-5', reasoning: OPENAI_REASONING }],
    },
  ]
}

const FIXTURE_IMAGE_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAAvklEQVR42u3SMQ0AAAjAMIyhELM4AAe8PD1qYFlk9cCXEAEDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGxIBCYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIAYEAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQDIgB4bYWLb6pnOb1xAAAAABJRU5ErkJggg=='
const FIXTURE_IMAGE_REF: ImageAttachmentRef = {
  attachmentId: 'fixture:image' as AttachmentIdType,
  mediaType: 'image/png',
  bytes: 247,
  width: 160,
  height: 90,
  name: 'fixture-image.png',
}

/** Deterministic provider billing attached to fixture assistant messages. */
function fixtureUsage(turn: number, step: number): TokenUsage {
  return {
    inputTokens: 20 + turn % 5,
    outputTokens: 8 + step,
    cacheReadTokens: turn === 0 ? 0 : 80,
    cacheWriteTokens: turn % 10 === 0 ? 4 : 0,
  }
}

/** Build a lossless settled stream for static fixture messages. */
function fixtureSettledStream(message: AssistantMessage, usage: TokenUsage, time: number): AssistantStreamRecord[] {
  const stream: AssistantStreamRecord[] = []
  for (const [index, block] of message.content.entries()) {
    stream.push(
      { type: 'chunk', time, chunk: { type: 'block-start', index, blockType: block.type } },
      { type: 'chunk', time, chunk: { type: 'block-end', index, block } },
    )
  }
  stream.push(
    { type: 'chunk', time, chunk: { type: 'usage', usage } },
    { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  )
  return stream
}

/** Rendered system prompt of the fx-alpha history: surface node 0. */
const FIXTURE_SYSTEM_PROMPT = '你是 DeepSeek Harness 的 fixture 助手。用简洁的中文回答，并在需要时调用工具。'

/**
 * fx-alpha history script: 76 turns (~150+ messages -> 4 pages at
 * PAGE_MESSAGES=50), mixing reasoning blocks / tool call+result / context; the
 * last turn stays open behind the resident pending approval.
 */
function buildAlphaLog(): SessionEvent[] {
  const events: Record<string, unknown>[] = []
  let time = Date.now() - 3_600_000
  const push = (e: Record<string, unknown>): number => {
    const seq = events.length
    const data = e['data'] as Record<string, unknown> | undefined
    const nextTime = time + 800
    const authored = e['type'] === 'assistant/message' && data !== undefined
      ? {
        ...e,
        data: {
          ...data,
          usage: fixtureUsage(data['turn'] as number, data['step'] as number),
          stream: fixtureSettledStream(
            data['message'] as AssistantMessage,
            fixtureUsage(data['turn'] as number, data['step'] as number),
            nextTime,
          ),
        },
      }
      : e
    events.push({ seq, time: (time = nextTime), ...authored })
    return seq
  }
  push({
    type: 'request/context',
    data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 128_000 },
  })
  for (let turn = 0; turn < 60; turn++) {
    push({ type: 'turn/start', data: { turn } })
    if (turn === 0) {
      push({
        type: 'system/message', surfaceOp: 'append',
        data: { turn, step: 0, message: createSystemMessage(FIXTURE_SYSTEM_PROMPT) },
      })
    }
    const userSeq = push({
      type: 'user/message', surfaceOp: 'append',
      data: userMessage(text(turn === 59 ? USER_MARKDOWN_LITERAL : `问题 ${turn}：fixture 历史消息，用于翻页与渲染验收。`)),
    })
    if (turn === 0) {
      push({
        type: 'session/title',
        data: { title: 'Fixture 历史会话', messageSeqs: [userSeq], source: { kind: 'fallback' } },
      })
    }
    if (turn % 9 === 4) {
      push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`[fixture] 上下文注入（turn ${turn}）`), LEGACY_FIXTURE_SOURCE) })
    }
    push({ type: 'step/start', data: { turn, step: 0 } })
    const withTool = turn % 5 === 2
    const withReasoning = turn % 3 === 1
    const blocks: ContentBlock[] = []
    if (withReasoning) blocks.push({ type: 'reasoning', text: `思考过程 ${turn}：这是一段可折叠的 reasoning 内容。` })
    blocks.push({ type: 'text', text: turn === 59 ? MARKDOWN_FIXTURE : `回答 ${turn}：这是 fixture 生成的历史回复正文。` })
    if (withTool) {
      const callId = `fx-call-${turn}`
      blocks.push({ type: 'tool-call', id: callId, name: 'echo', arguments: `{"text":"turn ${turn}"}` } as ContentBlock)
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 0, message: assistantMessage(blocks) } })
      push({ type: 'tool/call', data: { turn, step: 0, callId, name: 'echo', arguments: `{"text":"turn ${turn}"}` } })
      push({ type: 'tool/result', surfaceOp: 'append', data: { turn, step: 0, message: toolResultMessage(callId, text(`ECHO: TURN ${turn}`), turn % 25 === 12) } })
      push({ type: 'step/end', data: { turn, step: 0 } })
      push({ type: 'step/start', data: { turn, step: 1 } })
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: assistantMessage(text(`工具结果已消化（turn ${turn}）。`)) } })
      push({ type: 'step/end', data: { turn, step: 1 } })
    } else {
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 0, message: assistantMessage(blocks) } })
      push({ type: 'step/end', data: { turn, step: 0 } })
    }
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  const toolTurn = (turn: number, name: string, args: string, resultText: string, resultMeta?: unknown): void => {
    const callId = `fx-call-${turn}`
    push({ type: 'turn/start', data: { turn } })
    push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`问题 ${turn}：${name} 样本。`)) })
    push({ type: 'step/start', data: { turn, step: 0 } })
    push({
      type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 0, message: assistantMessage([{ type: 'tool-call', id: callId, name, arguments: args } as ContentBlock]) },
    })
    push({ type: 'tool/call', data: { turn, step: 0, callId, name, arguments: args } })
    push({
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn,
        step: 0,
        message: toolResultMessage(callId, text(resultText), false),
        ...resultMeta === undefined ? {} : { meta: resultMeta },
      },
    })
    push({ type: 'step/end', data: { turn, step: 0 } })
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  toolTurn(
    60,
    'bash',
    '{"command":"ls -la\\necho done","description":"fixture 终端样本","workdir":"/tmp/fixture"}',
    'total 2\ndrwxr-xr-x fixture\n-rw-r--r-- demo.txt',
  )
  toolTurn(
    61,
    'write',
    '{"file_path":"notes/demo.txt","content":"hello fixture\\n"}',
    'wrote notes/demo.txt',
    { diffs: [{ path: 'notes/demo.txt', oldText: null, newText: 'hello fixture\n' }] },
  )
  toolTurn(
    62,
    'edit',
    '{"file_path":"notes/demo.txt","old_string":"hello","new_string":"hello fixture"}',
    '已编辑',
    { diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }] },
  )
  toolTurn(
    63,
    'write',
    '{"file_path":"notes/new-demo.txt","content":"hello fixture\\n"}',
    '已写入',
    { diffs: [{ path: 'notes/new-demo.txt', oldText: null, newText: 'hello fixture\n' }] },
  )
  // Turn 64: a multi-hunk edit — two scattered replacements in one file.
  toolTurn(
    64,
    'edit',
    '{"file_path":"src/config.ts","old_string":"const timeout = 30","new_string":"const timeout = 60"}',
    '已编辑',
    {
      diffs: [
        { path: 'src/config.ts', oldText: 'const timeout = 30', newText: 'const timeout = 60' },
        { path: 'src/config.ts', oldText: 'retries: 1', newText: 'retries: 3' },
      ],
    },
  )
  // Turn 65: one run_code turn with three logged sub-dispatches.
  {
    const turn = 65
    const callId = `fx-call-${turn}`
    const program = 'const listing = await tools.bash({ command: "ls notes", description: "List notes" })\n'
      + 'const demo = await tools.read({ file_path: "notes/demo.txt" })\n'
      + 'await tools.read({ file_path: "notes/missing.txt" }).catch(() => "tolerated")\n'
      + 'return { listing, demo }'
    const args = JSON.stringify({ code: program, description: 'Read the notes files and summarize' })
    push({ type: 'turn/start', data: { turn } })
    push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`问题 ${turn}：run_code 样本。`)) })
    push({ type: 'step/start', data: { turn, step: 0 } })
    push({
      type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 0, message: assistantMessage([{ type: 'tool-call', id: callId, name: 'run_code', arguments: args } as ContentBlock]) },
    })
    push({ type: 'tool/call', data: { turn, step: 0, callId, name: 'run_code', arguments: args } })
    const dispatchPair = (n: number, name: string, dispatchArgs: Record<string, unknown>, resultText: string, isError = false): void => {
      push({
        type: 'tool/ptc-dispatch-start',
        data: { rootCallId: callId, parentCallId: callId, subCallId: `${callId}:ptc:${n}`, name, arguments: dispatchArgs },
      })
      push({
        type: 'tool/ptc-dispatch',
        data: {
          rootCallId: callId, parentCallId: callId, subCallId: `${callId}:ptc:${n}`, name,
          arguments: dispatchArgs, isError, content: [{ type: 'text', text: resultText }],
        },
      })
    }
    dispatchPair(1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt\nnew-demo.txt')
    dispatchPair(2, 'read', { file_path: 'notes/demo.txt' }, 'hello fixture\n')
    dispatchPair(3, 'read', { file_path: 'notes/missing.txt' }, 'Error: ENOENT: notes/missing.txt not found', true)
    push({
      type: 'tool/result', surfaceOp: 'append',
      data: { turn, step: 0, message: toolResultMessage(callId, text('{"listing":"demo.txt\\nnew-demo.txt","demo":"hello fixture\\n"}'), false) },
    })
    push({ type: 'step/end', data: { turn, step: 0 } })
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  // The todo_write sample's items: two in_progress, so the parallel plan
  // policy renders on both todo surfaces.
  const fixtureTodos = [
    { content: '梳理需求', status: 'completed' },
    { content: '实现 fixture 样本', status: 'in_progress' },
    { content: '跑后台构建', status: 'in_progress' },
    { content: '浏览器验收', status: 'pending' },
  ]
  // Turn 66: the terminal sample — SGR runs, output past the height cap, a
  // nested workdir, and a non-zero exit.
  toolTurn(
    66,
    'bash',
    '{"command":"pnpm run check","description":"fixture 终端样本","workdir":"/tmp/fixture/deep/nested"}',
    `${TERMINAL_OUTPUT_FIXTURE}\n[exit code: 1]`,
  )
  // Turns 67-68: the search card's two metadata variants.
  toolTurn(
    67,
    'grep',
    '{"pattern":"SEARCH_MAX_LINES","path":"packages/client"}',
    SEARCH_MATCHES_TEXT,
    { shape: 'matches', files: SEARCH_MATCHES_FIXTURE, truncated: true, total: 42 },
  )
  toolTurn(
    68,
    'glob',
    '{"pattern":"**/SearchBlock*","path":"packages/client"}',
    SEARCH_PATHS_TEXT,
    { shape: 'paths', paths: SEARCH_PATHS_FIXTURE, truncated: true, total: 23 },
  )
  // Turn 69: the read sample — a windowed read with line numbers and a lang hint.
  toolTurn(
    69,
    'read',
    `{"file_path":${JSON.stringify(READ_SAMPLE_PATH)},"offset":${READ_SAMPLE_FIRST_LINE}}`,
    READ_SAMPLE_TEXT,
    {
      path: READ_SAMPLE_PATH,
      offset: READ_SAMPLE_FIRST_LINE,
      lines: READ_SAMPLE_LINES,
      totalLines: READ_SAMPLE_TOTAL,
      lang: 'ts',
    },
  )
  // Turns 70-71: the web tools' result metadata.
  toolTurn(
    70,
    'web_search',
    '{"queries":["deepseek harness architecture"]}',
    'Search results for deepseek harness architecture.',
    WEB_SEARCH_META,
  )
  toolTurn(
    71,
    'web_fetch',
    '{"url":"https://www.deepseek.com/blog/harness-architecture"}',
    '# Harness architecture\n\nEverything is a plugin.',
    WEB_FETCH_META,
  )
  // Turn 72: max-tokens sample — the turn ends at the output cap mid-sentence.
  push({ type: 'turn/start', data: { turn: 72 } })
  push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text('问题 72：请完整列出全部一百条条目。')) })
  push({ type: 'step/start', data: { turn: 72, step: 0 } })
  push({
    type: 'assistant/message',
    surfaceOp: 'append',
    data: { turn: 72, step: 0, message: assistantMessage(text('条目 1：第一条。条目 2：第二条。条目 3：这一条写到一半被')) },
  })
  push({ type: 'step/end', data: { turn: 72, step: 0 } })
  push({ type: 'turn/end', data: { turn: 72, reason: { kind: 'max-tokens' } } })
  // Turn 73: user and assistant images share one durable fixture object.
  push({ type: 'turn/start', data: { turn: 73 } })
  push({
    type: 'user/message',
    surfaceOp: 'append',
    data: userMessage([{ type: 'image', attachment: FIXTURE_IMAGE_REF }, ...text('历史用户图片')]),
  })
  push({ type: 'step/start', data: { turn: 73, step: 0 } })
  push({
    type: 'assistant/message',
    surfaceOp: 'append',
    data: {
      turn: 73,
      step: 0,
      message: assistantMessage(
        [...text('结构化模型图片：'), { type: 'image', attachment: FIXTURE_IMAGE_REF }],
        'fx-vision',
      ),
    },
  })
  push({ type: 'step/end', data: { turn: 73, step: 0 } })
  push({ type: 'turn/end', data: { turn: 73, reason: { kind: 'completed' } } })
  // Approval-history sample (fx-alpha doubles as the ledger's running agent
  // run): one allowed-once pair carrying a reason, one rejected pair without.
  push({ type: 'approval/asked', data: { id: 'fx-approval-hist-1', toolName: 'bash', callId: 'fx-call-approval-1', reason: '写入工作区外路径' } })
  push({ type: 'approval/decided', data: { id: 'fx-approval-hist-1', outcome: 'allowed-once' } })
  push({ type: 'approval/asked', data: { id: 'fx-approval-hist-2', toolName: 'write' } })
  push({ type: 'approval/decided', data: { id: 'fx-approval-hist-2', outcome: 'rejected' } })
  const todoArgs = JSON.stringify({ todos: fixtureTodos })
  // Turn 75: the todo_write sample rides the session's LAST turn, which stays
  // open behind the resident pending approval: the todo_write step completes,
  // then the blocked bash call in step 1 leaves the turn unresulted — the
  // unresulted tool/call keeps the paired-command lookup exercised for the
  // daypaw approval card's details expander. The standing plan retires at the
  // NEXT turn/start, so the todo sample must live in the open turn itself.
  push({ type: 'turn/start', data: { turn: 75 } })
  push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text('问题 75：todo_write 样本。')) })
  push({ type: 'step/start', data: { turn: 75, step: 0 } })
  push({
    type: 'assistant/message', surfaceOp: 'append',
    data: { turn: 75, step: 0, message: assistantMessage([{ type: 'tool-call', id: 'fx-call-75', name: 'todo_write', arguments: todoArgs } as ContentBlock]) },
  })
  push({ type: 'tool/call', data: { turn: 75, step: 0, callId: 'fx-call-75', name: 'todo_write', arguments: todoArgs } })
  // The real tool appends the snapshot mid-execution — between tool/call and
  // tool/result — so the world reproduces that exact ordering.
  push({ type: 'todo/write', data: { todos: fixtureTodos } })
  push({ type: 'tool/result', surfaceOp: 'append', data: { turn: 75, step: 0, message: toolResultMessage('fx-call-75', text('Updated todo list: 1 pending, 2 in progress, 1 completed.'), false) } })
  push({ type: 'step/end', data: { turn: 75, step: 0 } })
  push({ type: 'step/start', data: { turn: 75, step: 1 } })
  push({
    type: 'tool/call',
    data: { turn: 75, step: 1, callId: 'fx-call-approval-live', name: 'bash', arguments: '{"command":"rm -rf /tmp/build-cache"}' },
  })
  events.forEach((e, i) => { e.seq = i })
  return events as unknown as SessionEvent[]
}

// ---------------------------------------------------------------------------
// Projection folds (host parallels; whole current values per key over a log)
// ---------------------------------------------------------------------------

/** Plan lifecycle fold: `command/run`+`command/done` pairs stage a selection, `plan/mode` commits it. */
function foldPlan(log: readonly SessionEvent[]): { active: boolean; pending: boolean; wanted: boolean | null } {
  let active = false
  let wanted: boolean | null = null
  let running: { commandId: unknown; wanted: boolean } | null = null
  for (const event of log) {
    const item = event as unknown as { type: string; data?: Record<string, unknown> }
    if (item.type === 'command/run' && item.data?.['name'] === 'plan') {
      const args = item.data['args']
      if (typeof args !== 'string') continue
      running = { commandId: item.data['commandId'], wanted: args.trim() !== 'off' }
    } else if (item.type === 'command/done'
      && item.data !== undefined
      && running !== null
      && item.data['commandId'] === running.commandId) {
      wanted = item.data['kind'] === 'success' && running.wanted !== active ? running.wanted : null
      running = null
    } else if (item.type === 'plan/mode') {
      active = item.data?.['active'] === true
      wanted = null
    }
  }
  const selected = running?.wanted ?? wanted
  return { active, pending: selected !== null && selected !== active, wanted: selected }
}

/** The plan projection's wire view over the full log. */
function planViewOf(log: readonly SessionEvent[]): { active: boolean; pending: boolean } {
  const plan = foldPlan(log)
  return { active: plan.active, pending: plan.pending }
}

/** Preset table (the host PermissionPresetService defaults). */
const PERMISSION_PRESETS: Record<string, { sandbox: string; approval: string; description: string }> = {
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never', description: 'Full file access without approval prompts.' },
}

/** Permissions-unit parallel: fold the three knob events, derive the select over the defaults. */
function permissionSelectOf(
  log: readonly SessionEvent[],
): { options: { value: string; name: string; description?: string }[]; currentValue: string } {
  let preset: string | null = null
  let sandbox = 'workspace-write'
  let approval = 'ask'
  for (const event of log) {
    const item = event as { type: string; data: Record<string, unknown> }
    if (item.type === 'permission/preset') preset = item.data['preset'] as string
    else if (item.type === 'sandbox/mode') sandbox = item.data['mode'] as string
    else if (item.type === 'approval/policy') approval = item.data['policy'] as string
  }
  const matches = (spec: { sandbox: string; approval: string }): boolean => spec.sandbox === sandbox && spec.approval === approval
  let currentValue = 'custom'
  const folded = preset === null ? undefined : PERMISSION_PRESETS[preset]
  if (preset !== null && folded !== undefined && matches(folded)) {
    currentValue = preset
  } else {
    for (const [name, spec] of Object.entries(PERMISSION_PRESETS)) {
      if (matches(spec)) { currentValue = name; break }
    }
  }
  return {
    options: [
      ...Object.entries(PERMISSION_PRESETS).map(([value, spec]) => ({ value, name: value, description: spec.description })),
      ...currentValue === 'custom' ? [{ value: 'custom', name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' }] : [],
    ],
    currentValue,
  }
}

interface TokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface UsageSample {
  turn: number
  step: number
  usage: TokenUsage
}

/** Read one provider usage sample from either durable carrier. */
function usageSampleOf(event: SessionEvent): UsageSample | undefined {
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  let usage = event.type === 'assistant/message' ? event.data.usage : undefined
  for (const member of expandAssistantStream(event.data.stream)) {
    if (member.chunk.type === 'usage') usage = member.chunk.usage
  }
  return usage === undefined
    ? undefined
    : { turn: event.data.turn, step: event.data.step, usage }
}

/** Token-meter parallel: the last-sample-replacing usage projection. */
function tokenUsageOf(log: readonly SessionEvent[]): TokenUsageProjection {
  const totals: TokenUsageProjection = {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  let last: { turn: number; step: number; buckets: TokenUsageProjection } | null = null
  for (const event of log) {
    const sample = usageSampleOf(event)
    if (sample === undefined) continue
    const buckets: TokenUsageProjection = {
      uncachedInputTokens: sample.usage.inputTokens,
      outputTokens: sample.usage.outputTokens,
      cacheReadTokens: sample.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: sample.usage.cacheWriteTokens ?? 0,
    }
    const previous = last?.turn === sample.turn && last.step === sample.step
      ? last.buckets
      : undefined
    totals.uncachedInputTokens += buckets.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0)
    totals.outputTokens += buckets.outputTokens - (previous?.outputTokens ?? 0)
    totals.cacheReadTokens += buckets.cacheReadTokens - (previous?.cacheReadTokens ?? 0)
    totals.cacheWriteTokens += buckets.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0)
    last = { turn: sample.turn, step: sample.step, buckets }
  }
  return totals
}

/** Session-stats parallel: whole-log counting and wall-time fold. */
function sessionStatsOf(log: readonly SessionEvent[]): {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
} {
  const value = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
  let lastTurn: number | null = null
  let openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null = null
  const pendingCalls = new Map<string, number>()
  for (const event of log) {
    switch (event.type) {
      case 'step/start':
        openStep = { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null }
        break
      case 'assistant/attempt': {
        if (openStep === null || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break
        const first = expandAssistantStream(event.data.stream).find(member => isTokenDelta(member.chunk))?.time
        if (openStep.firstTokenTime === null && first !== undefined) openStep.firstTokenTime = first
        break
      }
      case 'assistant/message': {
        if (openStep === null || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break
        const first = expandAssistantStream(event.data.stream).find(member => isTokenDelta(member.chunk))?.time
        if (openStep.firstTokenTime === null && first !== undefined) openStep.firstTokenTime = first
        value.llmMs += Math.max(0, event.time - openStep.startTime)
        if (openStep.firstTokenTime !== null) {
          value.ttftMs += Math.max(0, openStep.firstTokenTime - openStep.startTime)
          value.ttftSteps += 1
          const outputTokens = event.data.usage?.outputTokens
          if (typeof outputTokens === 'number' && Number.isFinite(outputTokens) && outputTokens >= 0) {
            value.decodeMs += Math.max(0, event.time - openStep.firstTokenTime)
            value.decodeTokens += outputTokens
          }
        }
        openStep = null
        break
      }
      case 'tool/call':
        pendingCalls.set(event.data.callId, event.time)
        break
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const dispatched = pendingCalls.get(callId)
        if (dispatched === undefined) break
        pendingCalls.delete(callId)
        value.toolMs += Math.max(0, event.time - dispatched)
        break
      }
      case 'step/end':
        if (event.data.turn !== lastTurn) {
          value.turns += 1
          lastTurn = event.data.turn
        }
        value.steps += 1
        openStep = null
        break
      case 'turn/end':
        pendingCalls.clear()
        break
      default:
        break
    }
  }
  return value
}

function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

interface RequestContext {
  provider: string
  model: string
  contextWindow?: number
}

/** Fixed token-density heuristic constants (token-meter parallel). */
const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

/** Price fixture content with token-meter's fixed-density heuristic. */
function estimateFixtureContent(blocks: readonly ContentBlock[]): number {
  const densityPrice = (value: string): number => Math.ceil(value.length / CHARS_PER_TOKEN)
  return blocks.reduce((tokens, block) => {
    if (block.type === 'text' || block.type === 'reasoning') {
      return tokens + densityPrice(block.text) + BLOCK_OVERHEAD
    }
    if (block.type === 'tool-call') {
      return tokens + densityPrice(block.name) + densityPrice(block.arguments) + BLOCK_OVERHEAD
    }
    // ContentBlockMap is merge-extensible: this client graph sees only the
    // base members, but fixture turns do carry extended blocks at runtime,
    // so the structural JSON fallback below is live code.
    return tokens + densityPrice(JSON.stringify(block)) + BLOCK_OVERHEAD
  }, 0)
}

/** Token-meter parallel: the heuristic context-composition projection. */
function contextBreakdownOf(log: readonly SessionEvent[]): { systemTokens: number; toolsTokens: number; messageTokens: number } {
  const headerEvent = log.findLast(event => event.type === 'request/header')
  const header = headerEvent === undefined ? undefined : headerEvent.data.header
  let systemTokens = 0
  let messageTokens = 0
  for (const seq of foldSurface(log).nodes) {
    const event = log[seq]
    if (event === undefined) continue
    const message = deriveEventMessage(event)
    if (message === null) continue
    if (message.role === 'system') {
      const characters = message.content.reduce(
        (total, block) => total + (block.type === 'text' ? block.text.length : JSON.stringify(block).length),
        0,
      )
      systemTokens = Math.ceil(characters / CHARS_PER_TOKEN) + ROLE_OVERHEAD
      continue
    }
    messageTokens += estimateFixtureContent(message.content) + ROLE_OVERHEAD
  }
  return {
    systemTokens,
    toolsTokens: header?.tools === undefined || header.tools.length === 0
      ? 0
      : Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD,
    messageTokens,
  }
}

/** Latest log-only route context, or undefined before any request ran. */
function lastRequestContext(log: readonly SessionEvent[]): RequestContext | undefined {
  const event = log.findLast(item => (item as { type: string }).type === 'request/context')
  return event === undefined ? undefined : (event as unknown as { data: RequestContext }).data
}

/** Token-meter parallel: the request-pressure projection. */
function contextPressureOf(log: readonly SessionEvent[]): { pressureTokens?: number; contextWindow?: number } {
  let pressureTokens: number | undefined
  for (const event of log) {
    const sample = usageSampleOf(event)
    if (sample === undefined) continue
    pressureTokens = sample.usage.inputTokens
      + (sample.usage.cacheReadTokens ?? 0)
      + (sample.usage.cacheWriteTokens ?? 0)
  }
  const contextWindow = lastRequestContext(log)?.contextWindow
  return {
    ...pressureTokens === undefined ? {} : { pressureTokens },
    ...contextWindow === undefined ? {} : { contextWindow },
  }
}

/** One entry of the approvalHistory projection value (the daypaw approval-history unit element). */
interface ApprovalHistoryEntry {
  id: string
  toolName: string
  reason?: string
  outcome?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
}

/**
 * The daypaw approvalHistory projection unit: `approval/asked` appends one
 * entry, `approval/decided` pairs by id and sets the outcome. Baseline and
 * live frames both derive from this fold.
 */
function approvalHistoryOf(log: readonly SessionEvent[]): ApprovalHistoryEntry[] {
  const entries: ApprovalHistoryEntry[] = []
  for (const event of log) {
    const item = event as { type: string; data: Record<string, unknown> }
    if (item.type === 'approval/asked') {
      entries.push({
        id: item.data['id'] as string,
        toolName: item.data['toolName'] as string,
        ...item.data['reason'] === undefined ? {} : { reason: item.data['reason'] as string },
      })
    } else if (item.type === 'approval/decided') {
      const entry = entries.find(e => e.id === item.data['id'])
      if (entry !== undefined) entry.outcome = item.data['outcome'] as NonNullable<ApprovalHistoryEntry['outcome']>
    }
  }
  return entries
}

function modelSelectionProjectionOf(log: readonly SessionEvent[]): { lastUsed: ModelSelection | null; next: ModelSelection | null } {
  let lastUsed: ModelSelection | null = null
  let pending: ModelSelection | null = null
  for (const event of log) {
    if ((event as { type: string }).type === 'model/selection') {
      pending = (event as unknown as { data: ModelSelection }).data
      continue
    }
    if (event.type !== 'request/header') continue
    lastUsed = {
      provider: event.data.header.config.provider,
      model: event.data.header.config.model,
      ...(event.data.header.config.reasoningEffort === undefined ? {} : { reasoningEffort: event.data.header.config.reasoningEffort }),
    }
    if (sameModelSelection(pending, lastUsed)) pending = null
  }
  return { lastUsed, next: pending ?? lastUsed }
}

function sameModelSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || (left !== null && right !== null
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort)
}

function projectionValuesOf(log: readonly SessionEvent[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  values['modelSelection'] = modelSelectionProjectionOf(log)
  const titleEvent = log.findLast(item => (item as { type: string }).type === 'session/title')
  if (titleEvent !== undefined) {
    values['title'] = (titleEvent as unknown as { data: { title: string } }).data.title
  }
  values['todos'] = backscanTodos(log) ?? null
  values['permissions'] = permissionSelectOf(log)
  values['plan'] = planViewOf(log)
  values['goal'] = backscanGoal(log)
  values['tokenUsage'] = tokenUsageOf(log)
  values['contextPressure'] = contextPressureOf(log)
  values['contextBreakdown'] = contextBreakdownOf(log)
  values['sessionStats'] = sessionStatsOf(log)
  values['imageLimits'] = {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 2000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }
  values['approvalHistory'] = approvalHistoryOf(log)
  return values
}

/** One Session control projection frame per key advanced by the event (host parallel). */
function projectionFramesOf(id: SessionId, log: readonly SessionEvent[], event: SessionEvent): ProjectionFrame[] {
  const type = (event as { type: string }).type
  const frames: ProjectionFrame[] = []
  if (type === 'model/selection' || type === 'request/header') {
    frames.push({
      type: 'projection',
      sessionId: id,
      key: 'modelSelection',
      value: modelSelectionProjectionOf(log),
      seq: event.seq,
    })
  }
  if (usageSampleOf(event) !== undefined) {
    frames.push(
      { type: 'projection', sessionId: id, key: 'tokenUsage', value: tokenUsageOf(log), seq: event.seq },
      { type: 'projection', sessionId: id, key: 'contextPressure', value: contextPressureOf(log), seq: event.seq },
    )
  }
  if (type === 'request/context') {
    frames.push({ type: 'projection', sessionId: id, key: 'contextPressure', value: contextPressureOf(log), seq: event.seq })
  }
  if (type === 'request/header'
    || type === 'system/message'
    || type === 'user/message'
    || type === 'assistant/message'
    || type === 'tool/result') {
    frames.push({ type: 'projection', sessionId: id, key: 'contextBreakdown', value: contextBreakdownOf(log), seq: event.seq })
  }
  if (type === 'approval/asked' || type === 'approval/decided') {
    frames.push({ type: 'projection', sessionId: id, key: 'approvalHistory', value: approvalHistoryOf(log), seq: event.seq })
  }
  if (type === 'assistant/message' || type === 'tool/result' || type === 'step/end') {
    frames.push({ type: 'projection', sessionId: id, key: 'sessionStats', value: sessionStatsOf(log), seq: event.seq })
  }
  if (frames.length > 0) return frames
  if (type === 'session/title') {
    const values = projectionValuesOf(log)
    if (!Object.hasOwn(values, 'title')) return []
    return [{ type: 'projection', sessionId: id, key: 'title', value: values['title'], seq: event.seq }]
  }
  if (type === 'goal/change') {
    return [{ type: 'projection', sessionId: id, key: 'goal', value: backscanGoal(log), seq: event.seq }]
  }
  if (type === 'todo/write' || type === 'turn/start') {
    return [{ type: 'projection', sessionId: id, key: 'todos', value: backscanTodos(log) ?? null, seq: event.seq }]
  }
  if (type === 'permission/preset' || type === 'sandbox/mode' || type === 'approval/policy') {
    return [{ type: 'projection', sessionId: id, key: 'permissions', value: permissionSelectOf(log), seq: event.seq }]
  }
  const commandData = event as unknown as { data: { name?: string; args?: unknown } }
  if (type === 'plan/mode' || (type === 'command/run'
    && commandData.data.name === 'plan' && typeof commandData.data.args === 'string')) {
    return [{ type: 'projection', sessionId: id, key: 'plan', value: planViewOf(log), seq: event.seq }]
  }
  return []
}

/**
 * Message-boundary paging mirrors the Host contract: count `maxMessages`
 * backwards from the end and cut at a turn/start boundary.
 */
/**
 * Mirror the Host's history window (session-controller `paginate`): walk back
 * from the end accumulating append-surface messages until the turn window
 * (minMessages inside minTurns) closes on a `turn/start` boundary, or the
 * maxMessages cap cuts the page at a source group's first seq.
 */
function pageOf(
  log: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
  throughSeq: number,
  turnWindow?: { readonly minMessages: number; readonly minTurns: number },
): { records: HistoryEntry[]; hasMore: boolean } {
  const end = Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1)
  let count = 0
  let turns = 0
  let cut = 0
  for (let index = end - 1; index >= 0; index--) {
    const event = log[index]
    if (event === undefined) break
    if (turnWindow !== undefined && event.type === 'turn/start') {
      turns++
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) {
        cut = index
        break
      }
    }
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    if (!isAppendSurfaceEvent(event)) continue
    count++
    let groupStart = event.seq
    const sources = event.sourceEventSeqs
    if (sources !== undefined) {
      for (const source of sources) if (source < groupStart) groupStart = source
    }
    if (count >= maxMessages) {
      cut = groupStart
      break
    }
  }
  return { records: log.slice(cut, end).map((event): HistoryEntry => ({ type: 'event', event })), hasMore: cut > 0 }
}

/** Read the wire's turn-window option (minMessages inside minTurns), when the caller sent one. */
function turnWindowOf(request: Record<string, unknown>): { minMessages: number; minTurns: number } | undefined {
  const window = request.turnWindow
  if (typeof window !== 'object' || window === null) return undefined
  const record = window as Record<string, unknown>
  const minMessages = record.minMessages
  const minTurns = record.minTurns
  if (typeof minMessages !== 'number' || typeof minTurns !== 'number') return undefined
  return { minMessages, minTurns }
}

/** Session-scoped attachment authorization: the log must name the attachment id. */
function logReferencesAttachment(log: readonly SessionEvent[], attachmentId: string): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit)
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    if (record.attachmentId === attachmentId) return true
    return Object.values(record).some(visit)
  }
  return log.some(event => visit(event.data))
}

/** Current plan projection over the full log: latest todo/write with no later turn/start. */
function backscanTodos(log: readonly SessionEvent[]): TodoItem[] | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i]
    if (event === undefined) continue
    if (event.type === 'turn/start') return undefined
    if (event.type === 'todo/write') return event.data.todos
  }
  return undefined
}

/** Goal projection value mirror (dsh-goal's GoalProjection shape). */
interface GoalProjection {
  goal: {
    id: string
    revision: number
    objective: string
    phase: 'active' | 'paused' | 'blocked' | 'complete'
    maxGoalRounds: number
  }
  roundsStarted: number
  createdAt: number
  updatedAt: number
}

type GoalChange =
  | { kind: 'goal/change'; version: 1; operation: 'clear'; cleared: { id: string; revision: number }; clearedAt: number }
  | {
    kind: 'goal/change'
    version: 1
    operation: 'create' | 'edit' | 'pause' | 'resume' | 'complete'
    goal: GoalProjection['goal']
    roundsStarted: number
    createdAt: number
    updatedAt: number
  }

/** Current goal projection over the full log: last-wins fold of goal/change whole values. */
function backscanGoal(log: readonly SessionEvent[]): GoalProjection | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i] as unknown as { type: string; data?: GoalChange } | undefined
    if (event === undefined || event.type !== 'goal/change' || event.data === undefined) continue
    const change = event.data
    if (change.operation === 'clear') return null
    return { goal: change.goal, roundsStarted: change.roundsStarted, createdAt: change.createdAt, updatedAt: change.updatedAt }
  }
  return null
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

/** The resident question set the fx-gamma waterfall carries. */
const FIXTURE_QUESTIONS: readonly QuestionItem[] = [
  {
    id: 'harness-profile',
    header: '偏好',
    question: '你现在更想招哪类 Agent/Harness 候选人？',
    options: [
      { label: '工程落地型 (Recommended)', description: '更看重能直接做 runtime、tool executor、sandbox、trace 和线上问题排查。' },
      { label: '研究潜力型', description: '更看重 Agent 理解、训练评测思路和长期成长空间。' },
      { label: '均衡型', description: '同时要求工程能力和 Agent 认知，但可能筛选门槛更高。' },
    ],
  },
  {
    id: 'work-mode',
    header: '方式',
    question: '你希望候选人优先展示哪种工作方式？',
    options: [
      { label: '先做小型原型 (Recommended)', description: '用可运行结果尽快验证关键假设。' },
      { label: '先写完整设计', description: '先收敛边界、协议和风险，再开始实现。' },
    ],
  },
  {
    id: 'signals',
    header: '信号',
    question: '哪些面试信号最重要？',
    detail: '按当前招聘目标选择；跳过则视为不设偏好。',
    multiSelect: true,
    options: [
      { label: '系统设计' },
      { label: '代码质量' },
      { label: 'Agent 产品判断' },
    ],
  },
]

/** The mock world this factory returns: the carrier-facing rpc plus the live-path controls the specs drive. */
export interface DaypawRemote {
  /** The RemoteMock world; `mock.rpc` is the Connection transport the carrier wraps. */
  readonly mock: RemoteMock
  /**
   * Append one approval asked/decided pair through the normal live path
   * (advances the approvalHistory projection on every open control stream).
   * @param sessionId - the session the pair lands on.
   * @param approvalId - the pair's shared id.
   * @param toolName - the asked entry's tool name.
   * @param outcome - the decided entry's outcome.
   */
  readonly appendApproval: (
    sessionId: string,
    approvalId: string,
    toolName: string,
    outcome: NonNullable<ApprovalHistoryEntry['outcome']>,
  ) => void
}

/**
 * Create the fork's RemoteMock world for one mount: the boot defaults of the
 * web assembly tier layered with the fx-world facts the golden lanes pin.
 * Each call mints fresh state, so repeated mounts never see earlier runs'
 * appends.
 * @returns the world handle.
 */
export function createDaypawRemote(): DaypawRemote {
  const sessions: SessionSummary[] = [
    { sessionId: sid('fx-alpha'), updatedAt: Date.now(), running: true, blank: false, cwd: '/tmp/fixture' },
    { sessionId: sid('fx-beta'), updatedAt: Date.now() - 60_000, running: false, blank: false, parentSessionId: sid('fx-alpha'), cwd: '/tmp/fixture' },
    { sessionId: sid('fx-gamma'), updatedAt: Date.now() - 120_000, running: false, blank: false, cwd: '/tmp/fixture' },
  ]
  const logs = new Map<SessionId, SessionEvent[]>([[sid('fx-alpha'), buildAlphaLog()]])
  const modelSelections = new Map<SessionId, ModelSelection>(sessions.map(session => [
    session.sessionId,
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  ]))
  const attachments = new Map<string, { attachment: ImageAttachmentRef; data: string }>([[
    String(FIXTURE_IMAGE_REF.attachmentId),
    { attachment: FIXTURE_IMAGE_REF, data: FIXTURE_IMAGE_DATA },
  ]])
  const fixtureCredentials = new Map<string, true>([
    // The world represents an already-configured shipped DeepSeek route so
    // GUI journeys do not enter first-run setup.
    ['DEEPSEEK_API_KEY', true],
  ])
  const fixturePresets = new Map<string, { trust: 'system' | 'user'; content: string }>([
    ['standard', { trust: 'system', content: "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n" }],
    ['minimal', { trust: 'system', content: "- id: tool-web-search\n  name: '@deepseek-ai/dsh-tool-web-search'\n" }],
    ['my-agent', { trust: 'user', content: "- id: tool-read\n  name: '@deepseek-ai/dsh-tool-read'\n" }],
  ])
  let fixtureDefaultPreset = 'standard'
  const nextTurn = new Map<SessionId, number>([[sid('fx-alpha'), 76]])
  let nextSession = 1
  const FIXTURE_HOME = '/home/fixture'
  const fixtureEpoch = new Date(Date.now() - 300_000).toISOString()
  const workspaces: WorkspaceView[] = [
    {
      workspaceId: 'fx-ws-fixture',
      path: '/tmp/fixture',
      title: 'fixture',
      sessionIds: [sid('fx-alpha'), sid('fx-beta'), sid('fx-gamma')],
      createdAt: fixtureEpoch,
      updatedAt: fixtureEpoch,
    }, {
      workspaceId: 'fx-ws-home',
      path: `${FIXTURE_HOME}/Documents/project`,
      title: 'project',
      sessionIds: [],
      createdAt: fixtureEpoch,
      updatedAt: fixtureEpoch,
    },
  ]
  /** Resident waterfalls retain their event ids across Remote Event generations. */
  const pendingApprovalEventId = 'fx-interaction-approval'
  let approvalPending = true
  const pendingQuestionEventId = 'fx-interaction-question'
  let questionPending = true
  let nextWorkspace = 1

  interface AttemptState {
    readonly attemptId: ReturnType<typeof LlmAttemptId>
    readonly startedAfterSeq: number
    readonly turn: number
    readonly step: number
    readonly stream: AssistantStreamAccumulator
    index: number
  }
  const activeAttempts = new Map<SessionId, AttemptState>()
  const assistantRevisions = new Map<SessionId, number>()
  /** At most one in-flight replay per session; cancel clears it. */
  const replays = new Map<SessionId, { timer: ReturnType<typeof setTimeout>; finish(aborted: boolean): void }>()

  const mock = RemoteMock.create({ host: { home: FIXTURE_HOME } }).load(remoteDefaultResponses)

  const follows = (sessionId: string): (args: readonly unknown[]) => boolean =>
    ([args]) => followedSessionId(recordValue(args, 'request')) === sessionId

  const emitControl = (frame: ControlFrame): void => { mock.streams.push('session/control', frame) }
  const emitWorkspace = (frame: WorkspaceFollowFrame): void => { mock.streams.push('workspace/follow', frame) }
  const emitRemote = (event: string, args: readonly unknown[]): void => {
    const frame: RemoteEventNotificationFrame = { type: 'emit', event, args }
    mock.streams.push('$events', frame)
  }
  const emitFollow = (sessionId: SessionId, entry: HistoryEntry): void => {
    mock.streams.push('session/follow', entry, follows(sessionId))
  }
  const emitAssistant = (sessionId: SessionId, frame: AssistantStreamFrame): void => {
    mock.streams.push('session/follow', { type: 'assistant-stream', frame }, follows(sessionId))
  }
  const nextAssistantRevision = (sessionId: SessionId): number => {
    const revision = (assistantRevisions.get(sessionId) ?? 0) + 1
    assistantRevisions.set(sessionId, revision)
    return revision
  }
  const summaryOf = (id: SessionId): SessionSummary | undefined => sessions.find(s => s.sessionId === id)
  const setRunning = (id: SessionId, running: boolean): void => {
    const summary = summaryOf(id)
    if (summary === undefined || summary.running === running) return
    summary.running = running
    emitRemote('api-session/status', [id, running])
  }
  const logOf = (id: SessionId): SessionEvent[] => {
    let log = logs.get(id)
    if (log === undefined) {
      log = []
      logs.set(id, log)
    }
    return log
  }
  const append = (id: SessionId, e: Record<string, unknown>): SessionEvent => {
    const log = logOf(id)
    const event = { seq: SessionSeq(log.length), time: Date.now(), ...e } as unknown as SessionEvent
    log.push(event)
    emitFollow(id, { type: 'event', event })
    for (const frame of projectionFramesOf(id, log, event)) emitControl(frame)
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      const summary = summaryOf(id)
      if (summary !== undefined) summary.updatedAt = event.time
      emitRemote('api-session/activity', [id, event.time])
    }
    return event
  }
  const beginAssistant = (sessionId: SessionId, turn: number, step: number): AttemptState => {
    const attemptId = LlmAttemptId(`${sessionId}:fixture:${String(nextAssistantRevision(sessionId))}`)
    const lastSeq = logOf(sessionId).length - 1
    const startedAfterSeq = lastSeq < 0 ? -1 : SessionSeq(lastSeq)
    const attempt = { attemptId, startedAfterSeq, turn, step, stream: new AssistantStreamAccumulator(), index: 0 }
    activeAttempts.set(sessionId, attempt)
    emitAssistant(sessionId, {
      type: 'start', attemptId, revision: assistantRevisions.get(sessionId) as number,
      startedAfterSeq, turn, step,
    })
    return attempt
  }
  const pushAssistant = (sessionId: SessionId, chunk: StreamChunk): void => {
    const attempt = activeAttempts.get(sessionId)
    if (attempt === undefined) throw new Error(`daypaw world: no active Assistant attempt for ${sessionId}`)
    const timed = attempt.stream.push({ time: Date.now(), chunk })
    emitAssistant(sessionId, {
      type: 'chunk', attemptId: attempt.attemptId, revision: nextAssistantRevision(sessionId),
      index: attempt.index++, time: timed.time, chunk: timed.chunk,
    })
  }
  const commitAssistant = (sessionId: SessionId, event: SessionEvent): void => {
    const attempt = activeAttempts.get(sessionId)
    if (attempt === undefined) throw new Error(`daypaw world: no active Assistant attempt for ${sessionId}`)
    activeAttempts.delete(sessionId)
    emitAssistant(sessionId, {
      type: 'end', attemptId: attempt.attemptId, revision: nextAssistantRevision(sessionId),
      index: attempt.index,
      outcome: {
        kind: 'committed',
        eventType: event.type === 'assistant/message' ? 'assistant/message' : 'assistant/attempt',
        seq: event.seq,
      },
    })
  }

  /** Prompt replay: chunk typewriter (80ms/frame) -> assistant/message finalize -> turn/end + running flip. */
  const startReply = (id: SessionId, turn: number, replyText: string): void => {
    const step = 0
    append(id, { type: 'step/start', data: { turn, step } })
    beginAssistant(id, turn, step)
    pushAssistant(id, { type: 'block-start', index: 0, blockType: 'text' })
    const pieces = replyText.match(/[\s\S]{1,6}/gu) ?? [replyText]
    let i = 0
    const finish = (aborted: boolean): void => {
      replays.delete(id)
      const done = pieces.slice(0, i).join('')
      pushAssistant(id, { type: 'block-end', index: 0, block: { type: 'text', text: done } })
      pushAssistant(id, { type: 'usage', usage: fixtureUsage(turn, step) })
      if (!aborted) pushAssistant(id, { type: 'finish', reason: { kind: 'stop' } })
      const attempt = activeAttempts.get(id) as AttemptState
      const message = append(id, {
        type: 'assistant/message',
        surfaceOp: 'append',
        data: {
          turn,
          step,
          message: assistantMessage(text(done)),
          stream: attempt.stream.snapshot(),
          usage: fixtureUsage(turn, step),
          ...(aborted ? { interrupted: true } : {}),
        },
      })
      commitAssistant(id, message)
      append(id, { type: 'step/end', data: { turn, step } })
      append(id, { type: 'turn/end', data: {
        turn,
        reason: aborted ? { kind: 'aborted', reason: { kind: 'user' } } : { kind: 'completed' },
      } })
      setRunning(id, false)
    }
    const tick = (): void => {
      const piece = pieces[i]
      if (piece === undefined) {
        finish(false)
        return
      }
      i++
      pushAssistant(id, { type: 'text-delta', index: 0, text: piece })
      replays.set(id, { timer: setTimeout(tick, 80), finish })
    }
    replays.set(id, { timer: setTimeout(tick, 80), finish })
  }

  const failure = (code: string, message: string, details: Record<string, unknown>) => ({
    ok: false as const,
    error: { code, message, details },
  })

  // ---- streams ----

  mock.stream('$events', (_args, stream) => {
    stream.push({ type: 'ready', clientId: randomUUID(), host: { home: FIXTURE_HOME } })
    if (approvalPending) stream.push(approvalInvocation())
    if (questionPending) stream.push(questionInvocation())
  })

  mock.stream('session/control', (_args, stream) => {
    stream.push(controlBaseline())
  })

  mock.stream('workspace/follow', (_args, stream) => {
    stream.push({
      type: 'baseline',
      value: {
        items: workspaces.map(workspace => ({ ...workspace, sessionIds: [...workspace.sessionIds] })),
        archivedSessionIds: [],
        pinnedSessionIds: [],
      },
    })
  })

  mock.stream('session/follow', (args, stream) => {
    const request = recordValue(args[0], 'request')
    const sessionId = followedSessionId(request)
    const summary = summaryOf(sessionId)
    if (summary === undefined) {
      stream.fail(new Error(`daypaw world: no session ${sessionId}`))
      return
    }
    const snapshot = [...logOf(sessionId)]
    const cursor = snapshot.at(-1)?.seq ?? -1
    const initial = pageOf(snapshot, undefined, readNumber(request, 'maxMessages', 50), cursor, turnWindowOf(request))
    stream.push({
      type: 'snapshot',
      header: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: summary.updatedAt,
        ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
        ...(summary.parentSessionId === undefined ? {} : { parentSession: summary.parentSessionId }),
        isSeeded: summary.parentSessionId !== undefined,
        ...(summary.origin === undefined ? {} : { origin: summary.origin }),
        ...(summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset }),
      } satisfies SessionWireHeader,
      cursor,
      records: initial.records,
      hasMore: initial.hasMore,
      projections: { asOfSeq: cursor, values: projectionValuesOf(snapshot) },
      ...isRecord(request) && request.assistantStream === true ? {
        assistantStream: {
          revision: assistantRevisions.get(sessionId) ?? 0,
          ...(activeAttempts.get(sessionId) === undefined
            ? {}
            : { activeAttempt: activeAttemptOf(activeAttempts.get(sessionId) as AttemptState) }),
        },
      } : {},
    })
  })

  // ---- session rules ----

  mock.unary('session/list', () => ok({ items: [...sessions].sort((a, b) => b.updatedAt - a.updatedAt) }))

  mock.unary('session/create', (args: unknown) => {
    const request = recordValue(args, 'request') as {
      sessionId?: string
      workspaceId?: string
      cwd?: string
    }
    const workspace = request.workspaceId === undefined
      ? undefined
      : workspaces.find(w => w.workspaceId === request.workspaceId)
    if (request.workspaceId !== undefined && workspace === undefined) {
      return failure('workspace/not-found', `no workspace ${request.workspaceId}`, { workspaceId: request.workspaceId })
    }
    const cwd = workspace?.path ?? request.cwd ?? '/tmp/fixture'
    const requestedId = request.sessionId
    if (requestedId !== undefined) {
      const existing = summaryOf(sid(requestedId))
      if (existing !== undefined) {
        if (existing.cwd !== cwd) {
          return failure('session/conflict', `session ${requestedId} already uses ${existing.cwd ?? 'no cwd'}`, {
            sessionId: requestedId, requestedCwd: cwd, ...existing.cwd === undefined ? {} : { existingCwd: existing.cwd },
          })
        }
        return ok({ sessionId: sid(requestedId) })
      }
    }
    const created: SessionSummary = {
      sessionId: sid(requestedId ?? `fx-${nextSession++}`), updatedAt: Date.now(), running: false, blank: true, cwd,
    }
    sessions.push(created)
    logs.set(created.sessionId, [])
    modelSelections.set(created.sessionId, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    if (workspace !== undefined && !workspace.sessionIds.includes(created.sessionId)) {
      workspace.sessionIds = [created.sessionId, ...workspace.sessionIds]
      workspace.updatedAt = new Date().toISOString()
      emitWorkspace({ type: 'upsert', workspace: { ...workspace, sessionIds: [...workspace.sessionIds] } })
    }
    emitRemote('api-session/added', [created])
    return ok({ sessionId: created.sessionId })
  })

  mock.unary('workspace/create', (args: unknown) => {
    const request = recordValue(args, 'request') as { path: string }
    const existing = workspaces.find(workspace => workspace.path === request.path)
    if (existing !== undefined) {
      return ok({ workspace: { ...existing, sessionIds: [...existing.sessionIds] }, created: false })
    }
    const now = new Date().toISOString()
    const created: WorkspaceView = {
      workspaceId: `fx-ws-${nextWorkspace++}`,
      path: request.path,
      title: request.path.split('/').filter(Boolean).at(-1) ?? request.path,
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    workspaces.unshift(created)
    emitWorkspace({ type: 'upsert', workspace: { ...created, sessionIds: [] } })
    return ok({ workspace: { ...created, sessionIds: [] }, created: true })
  })

  mock.unary('session/prompt', (args: unknown) => {
    const request = recordValue(args, 'request') as {
      sessionId: string
      requestId: string
      mode?: string
      content: readonly PromptPart[]
    }
    const id = sid(request.sessionId)
    const summary = summaryOf(id)
    if (summary === undefined) {
      return failure('session/not-found', `no session ${id}`, { sessionId: id })
    }
    summary.updatedAt = Date.now()
    summary.blank = false
    const userText = request.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    const durable: ContentBlock[] = request.content.map((block) => {
      if (block.type === 'text') return block
      const attachment: ImageAttachmentRef = {
        attachmentId: `fixture:${randomUUID()}` as AttachmentIdType,
        mediaType: block.mediaType,
        bytes: Math.max(
          1,
          Math.floor(block.data.length * 3 / 4)
            - (block.data.endsWith('==') ? 2 : block.data.endsWith('=') ? 1 : 0),
        ),
        width: 160,
        height: 90,
        ...block.name === undefined ? {} : { name: block.name },
      }
      attachments.set(String(attachment.attachmentId), { attachment, data: block.data })
      return { type: 'image', attachment }
    })
    const promptSource = { kind: 'user', rpcId: request.requestId } as MessageSource
    if (request.mode === 'steer' && replays.has(id)) {
      // Steering: the durable user/message lands inside the current turn; the replay continues.
      append(id, { type: 'user/message', surfaceOp: 'append', data: userMessage(durable, promptSource) })
      return ok({ accepted: true })
    }
    const turn = nextTurn.get(id) ?? 0
    nextTurn.set(id, turn + 1)
    setRunning(id, true)
    append(id, { type: 'turn/start', data: { turn } })
    const plan = foldPlan(logOf(id))
    if (plan.wanted !== null && plan.wanted !== plan.active) {
      append(id, { type: 'plan/mode', data: { active: plan.wanted } })
    }
    append(id, { type: 'user/message', surfaceOp: 'append', data: userMessage(durable, promptSource) })
    const selection = modelSelections.get(id) ?? { provider: 'deepseek', model: 'deepseek-v4-flash' }
    const previousHeader = logOf(id).findLast(event => event.type === 'request/header')
    const previousSelection = previousHeader?.type === 'request/header'
      ? {
        provider: previousHeader.data.header.config.provider,
        model: previousHeader.data.header.config.model,
        ...(previousHeader.data.header.config.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: previousHeader.data.header.config.reasoningEffort }),
      }
      : null
    if (!sameModelSelection(previousSelection, selection)) {
      append(id, {
        type: 'request/header',
        data: { header: { config: selection }, reason: previousHeader === undefined ? 'initial' : 'change' },
      })
    }
    if (lastRequestContext(logOf(id))?.model !== selection.model) {
      append(id, {
        type: 'request/context',
        data: { provider: selection.provider, model: selection.model, contextWindow: 128_000 },
      })
    }
    startReply(
      id,
      turn,
      userText === 'render markdown'
        ? MARKDOWN_FIXTURE
        : userText === 'report model'
          ? (() => {
            const selected = modelSelections.get(id)
            return `当前模型：${selected?.provider ?? 'unknown'}/${selected?.model ?? 'unknown'}`
              + (selected?.reasoningEffort === undefined ? '' : ` · 推理等级：${selected.reasoningEffort}`)
          })()
          : `回声：${userText}。这是 fixture 的流式回复，用于验证打字机增长与定稿切换。`,
    )
    return ok({ accepted: true })
  })

  mock.unary('session/page', (args: unknown) => {
    const page = recordValue(args, 'request') as PageRequest
    const log = logs.get(page.address.sessionId) ?? []
    const throughSeq = page.throughSeq ?? log.length - 1
    return ok(pageOf(log, page.beforeSeq, page.maxMessages ?? 50, throughSeq, page.turnWindow))
  })

  mock.unary('session/attachment', (args: unknown) => {
    const request = recordValue(args, 'request') as { sessionId: string; attachmentId: string }
    const stored = attachments.get(request.attachmentId)
    if (stored === undefined) {
      return failure('session/attachment-invalid', 'fixture attachment missing', { reason: 'ATTACHMENT_NOT_FOUND' })
    }
    if (!logReferencesAttachment(logs.get(sid(request.sessionId)) ?? [], request.attachmentId)) {
      return failure('session/attachment-invalid', 'fixture attachment is not referenced by this session', { reason: 'ATTACHMENT_NOT_REFERENCED' })
    }
    return ok(stored)
  })

  mock.unary('session/cancel', (args: unknown) => {
    const request = recordValue(args, 'request') as { sessionId: string }
    const id = sid(request.sessionId)
    const replay = replays.get(id)
    if (replay !== undefined) {
      clearTimeout(replay.timer)
      replay.finish(true)
    } else {
      setRunning(id, false)
    }
    return ok({ accepted: true })
  })

  mock.unary('session/updateQueue', (args: unknown) => {
    const request = recordValue(args, 'request') as { itemId: string }
    return failure('session/queue-item-not-found', 'fixture has no pending queue item', { itemId: request.itemId })
  })

  mock.unary('session/selectModel', (args: unknown) => {
    const request = recordValue(args, 'request') as {
      sessionId: string
      provider: string
      model: string
      reasoningEffort?: string
    }
    const selected: ModelSelection = {
      provider: request.provider,
      model: request.model,
      ...request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort },
    }
    append(sid(request.sessionId), { type: 'model/selection', data: selected })
    modelSelections.set(sid(request.sessionId), selected)
    return ok({ selected })
  })

  mock.unary('$events/result', (result: unknown) => {
    const answer = result as RemoteEventResult
    if (answer.eventId === pendingApprovalEventId) {
      if (!approvalPending) return ok(undefined)
      approvalPending = false
    } else if (answer.eventId === pendingQuestionEventId) {
      if (!questionPending) return ok(undefined)
      questionPending = false
    } else {
      return ok(undefined)
    }
    mock.streams.push('$events', { type: 'cancel', eventId: answer.eventId } satisfies RemoteEventCancellationFrame)
    return ok(undefined)
  })

  // ---- settings, credentials, model faces ----

  mock.unary('settings/describe', () => ok({
    writable: true,
    hasDocument: true,
    namespaces: [{
      ns: 'llm-deepseek',
      schema: {},
      value: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
      applies: 'live',
      secrets: [{ path: ['apiKey'], set: false }],
      revision: 0,
    }],
  }))
  mock.unary('settings/canOpenAgentPresetDirectory', () => ok(true))
  mock.unary('settings/openSettingsDocument', () => ok({ opened: true }))
  // The readiness descriptor is read-only: every mutation channel answers a
  // rejection, so theme- and preference-driven writes fall back to their
  // local persistence paths.
  mock.unary('settings/update', (args: unknown) => failure('settings/rejected', 'fixture: the minimal readiness settings descriptor is read-only', { ns: recordString(args, 'ns') }))
  mock.unary('settings/replace', (args: unknown) => failure('settings/rejected', 'fixture: the minimal readiness settings descriptor is read-only', { ns: recordString(args, 'ns') }))
  mock.unary('settings/mutate', (args: unknown) => failure('settings/rejected', 'fixture: no settings namespaces are registered', { ns: recordString(args, 'ns') }))
  mock.unary('settings/openAgentPresetDirectory', (args: unknown) => {
    const agentPreset = recordString(args, 'agentPreset')
    const existing = fixturePresets.get(agentPreset)
    if (existing === undefined || existing.trust === 'system') {
      return failure('agent-preset/read-only', `agent preset "${agentPreset}" ships with the deployment`, { agentPreset, reason: 'it ships with the deployment' })
    }
    return ok({ opened: true })
  })

  mock.unary('credentials/describe', (args: unknown) => {
    const refs = (args as { refs?: readonly string[] }).refs ?? []
    return ok(Object.fromEntries(refs.map(ref => [ref, {
      configured: fixtureCredentials.has(ref),
      ...fixtureCredentials.has(ref) ? { source: 'file' } : {},
      writable: true,
    }] as [string, CredentialInfo])))
  })
  mock.unary('credentials/set', (args: unknown) => {
    fixtureCredentials.set(recordString(args, 'ref'), true)
    return ok(undefined)
  })
  mock.unary('credentials/unset', (args: unknown) => {
    fixtureCredentials.delete(recordString(args, 'ref'))
    return ok(undefined)
  })

  mock.unary('session/modelCatalog', () => ok({
    default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routableProviders: ['deepseek-official', 'openai', 'acme-gateway'],
    groups: fixtureModelGroups(),
    failures: [],
  }))
  mock.unary('llm/listProviders', () => ok([
    { id: 'deepseek-official', name: 'DeepSeek' },
    { id: 'openai', name: 'openai' },
    { id: 'acme-gateway', name: 'Acme Gateway' },
  ]))
  mock.unary('llm/listConfigurableProviders', () => ok([
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
    { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], declared: false },
    { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], declared: false },
    { provider: 'acme-gateway', displayName: 'Acme Gateway', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme-gateway'], declared: true },
  ]))

  // ---- composer faces ----

  mock.unary('commands/list', (args: unknown) => {
    const sessionId = recordString(args, 'agentId')
    if (summaryOf(sid(sessionId)) === undefined) {
      return failure('session/not-found', `no session ${sessionId}`, { sessionId })
    }
    return ok([
      { name: 'compact', description: 'fixture：压缩当前会话上下文' },
      { name: 'echo', description: 'fixture：回显参数', input: { hint: 'text to echo' } },
      { definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-command-goal'), name: 'goal', description: 'Set or view the goal for a long-running task', input: { hint: '<objective>', attachments: true } },
      { definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-permission-presets'), name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)', input: { hint: '<preset>' } },
      { definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-plan-mode'), name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]', attachments: true } },
    ] satisfies readonly CommandDescriptor[])
  })

  mock.unary('commands/execute', (args: unknown) => {
    const sessionId = sid(recordString(args, 'agentId'))
    const line = optionalRecordString(args, 'line') ?? ''
    if (summaryOf(sessionId) === undefined) {
      return failure('session/not-found', `no session ${sessionId}`, { sessionId })
    }
    const match = /^\/(\S+)((?:\s.*)?)$/.exec(line.trim())
    const name = match?.[1]
    const commandArgs = match?.[2] ?? ''
    if (name === 'permission') {
      const preset = commandArgs.trim()
      const commandId = `fx-cmd-${logOf(sessionId).length}` as ReturnType<typeof brandString<CommandId>>
      append(sessionId, { type: 'command/run', data: { commandId, name, args: commandArgs, source: { kind: 'user' } } })
      const spec = PERMISSION_PRESETS[preset]
      let result: CommandResult
      if (preset === '') {
        const current = permissionSelectOf(logOf(sessionId)).currentValue
        result = { kind: 'success', text: `current preset ${current} (available: ${Object.keys(PERMISSION_PRESETS).join(', ')})` }
      } else if (spec === undefined) {
        result = { kind: 'error', text: `unknown preset "${preset}" (available: ${Object.keys(PERMISSION_PRESETS).join(', ')})` }
      } else {
        if (permissionSelectOf(logOf(sessionId)).currentValue !== preset) append(sessionId, { type: 'permission/preset', data: { preset } })
        append(sessionId, { type: 'sandbox/mode', data: { mode: spec.sandbox } })
        append(sessionId, { type: 'approval/policy', data: { policy: spec.approval } })
        result = { kind: 'success', text: `preset ${preset}` }
      }
      append(sessionId, { type: 'command/done', data: { commandId, ...result } })
      return ok({ commandId, result } satisfies CommandExecution)
    }
    if (name === 'goal') {
      const commandId = `fx-cmd-${logOf(sessionId).length}` as ReturnType<typeof brandString<CommandId>>
      append(sessionId, { type: 'command/run', data: { commandId, name, args: commandArgs, source: { kind: 'user' } } })
      const objective = commandArgs.trim()
      const current = backscanGoal(logOf(sessionId))
      let goalText: string
      if (objective === '') {
        goalText = current === null ? 'No goal is set. Usage: /goal <objective>' : `Current goal: ${current.goal.objective}`
      } else if (current !== null && current.goal.phase !== 'complete') {
        goalText = `A goal already exists (${current.goal.objective}). Clear it first.`
      } else {
        append(sessionId, {
          type: 'goal/change',
          data: {
            kind: 'goal/change', version: 1, operation: 'create',
            goal: { id: `fx-goal-${logOf(sessionId).length}`, revision: 1, objective, phase: 'active', maxGoalRounds: 256 },
            roundsStarted: 0, createdAt: Date.now(), updatedAt: Date.now(),
          },
        })
        goalText = `Goal created: ${objective}`
      }
      const result: CommandResult = { kind: 'success', text: goalText }
      append(sessionId, { type: 'command/done', data: { commandId, ...result } })
      return ok({ commandId, result } satisfies CommandExecution)
    }
    const running = summaryOf(sessionId)?.running === true
    const outcomes: Record<string, string> = {
      compact: 'fixture：已压缩（假动作）',
      echo: commandArgs.trim(),
      plan: commandArgs.trim() === 'off'
        ? (running ? 'Leaving plan mode (applies from the next step).' : 'Plan mode off.')
        : (running
          ? 'Entering plan mode (applies from the next step). Use /plan off to leave.'
          : 'Plan mode on. Use /plan off to leave.'),
    }
    const commandText = name === undefined ? undefined : outcomes[name]
    if (name === undefined || commandText === undefined) return ok(undefined)
    const commandId = `fx-cmd-${logOf(sessionId).length}` as ReturnType<typeof brandString<CommandId>>
    append(sessionId, { type: 'command/run', data: { commandId, name, args: commandArgs, source: { kind: 'user' } } })
    if (name === 'plan' && !running) {
      const plan = foldPlan(logOf(sessionId))
      if (plan.wanted !== null && plan.wanted !== plan.active) {
        append(sessionId, { type: 'plan/mode', data: { active: plan.wanted } })
      }
    }
    const result: CommandResult = { kind: 'success', ...commandText === '' ? {} : { text: commandText } }
    append(sessionId, { type: 'command/done', data: { commandId, ...result } })
    return ok({ commandId, result } satisfies CommandExecution)
  })

  mock.unary('agentPresets/list', () => ok({
    presets: [...fixturePresets].map(([id, preset]) => ({
      id,
      trust: preset.trust,
      isDefault: id === fixtureDefaultPreset,
    })),
    authorable: true,
    modeSelectionEnabled: true,
  }))
  mock.unary('agentPresets/select', (args: unknown) => {
    fixtureDefaultPreset = recordString(args, 'agentPreset')
    return ok(fixtureDefaultPreset)
  })
  mock.unary('agentPresets/read', (args: unknown) => {
    const agentPreset = recordString(args, 'agentPreset')
    const preset = fixturePresets.get(agentPreset)
    if (preset === undefined) {
      return failure('agent-preset/not-found', `unknown agent preset "${agentPreset}"`, { agentPreset, available: [...fixturePresets.keys()] })
    }
    return ok({ agentPreset, trust: preset.trust, content: preset.content })
  })
  mock.unary('agentPresets/copy', (args: unknown) => {
    const from = recordString(args, 'from')
    const id = recordString(args, 'id')
    const source = fixturePresets.get(from)
    if (source === undefined) {
      return failure('agent-preset/not-found', `unknown agent preset "${from}"`, { agentPreset: from, available: [...fixturePresets.keys()] })
    }
    if (fixturePresets.has(id)) {
      return failure('agent-preset/invalid', `agent preset "${id}" already exists`, { agentPreset: id, reason: 'already exists' })
    }
    fixturePresets.set(id, { trust: 'user', content: source.content })
    return ok(undefined)
  })
  mock.unary('agentPresets/deletePreset', (args: unknown) => {
    const id = recordString(args, 'id')
    if (fixturePresets.get(id)?.trust === 'system') {
      return failure('agent-preset/read-only', `agent preset "${id}" ships with the deployment`, { agentPreset: id, reason: 'it ships with the deployment' })
    }
    fixturePresets.delete(id)
    return ok(undefined)
  })

  mock.unary('skills/list', (args: unknown) => {
    const request = recordValue(args, 'request') as { sessionId: string }
    if (summaryOf(sid(request.sessionId)) === undefined) {
      return failure('session/not-found', `no session ${request.sessionId}`, { sessionId: request.sessionId })
    }
    return ok({
      skills: [
        { name: 'fixture-demo', description: 'fixture 技能样本', whenToUse: '仅供 UI 目录渲染验收', modelInvocable: true },
        { name: 'fixture-user-only', description: 'fixture 仅用户技能样本', modelInvocable: false },
      ],
    })
  })
  mock.unary('subagents/list', () => ok({ entries: [], parentAvailable: true }))
  mock.unary('subagents/prompt', (args: unknown) => {
    const request = recordValue(args, 'request') as { childSessionId: string }
    return ok({ messageId: `fixture-message-${request.childSessionId}` })
  })
  mock.unary('subagents/interruptByParent', () => ok({ accepted: true }))
  mock.unary('fileReferences/list', (args: unknown) => {
    const query = (optionalRecordString(args, 'query') ?? '').toLocaleLowerCase()
    return ok([
      { path: 'notes', kind: 'directory' as const },
      { path: 'README.md', kind: 'file' as const },
      { path: 'notes/demo.txt', kind: 'file' as const },
    ].filter(item => item.path.toLocaleLowerCase().includes(query)))
  })
  mock.unary('sessionReferenceResolver/candidates', (args: unknown) => {
    const query = (optionalRecordString(args, 'query') ?? '').toLocaleLowerCase()
    return ok(sessions
      .filter(item => String(item.sessionId).toLocaleLowerCase().includes(query)
        || item.cwd?.toLocaleLowerCase().includes(query) === true)
      .map((item) => {
        const label = item.sessionId === sid('fx-beta') ? 'Fixture child session' : String(item.sessionId)
        const encoded = btoa(JSON.stringify(item.sessionId)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
        return {
          sessionId: item.sessionId,
          label,
          ...item.cwd === undefined ? {} : { cwd: item.cwd },
          createdAt: item.updatedAt,
          mention: `@[${label}](dsh-session:${encoded})`,
        }
      }))
  })
  mock.unary('session/canOpenWorkspacePath', () => ok(true))
  mock.unary('session/openWorkspacePath', () => ok({ opened: true }))

  const controlBaseline = (): Extract<ControlFrame, { type: 'baseline' }> => {
    const queues: Record<string, readonly never[]> = {}
    const jobs: Record<string, readonly never[]> = {}
    const projections: Record<string, ProjectionsBlock> = {}
    for (const summary of sessions) {
      queues[summary.sessionId] = []
      jobs[summary.sessionId] = []
      const log = logs.get(summary.sessionId) ?? []
      projections[summary.sessionId] = { asOfSeq: log.length - 1, values: projectionValuesOf(log) }
    }
    return { type: 'baseline', value: { queues, jobs, approvals: [], questions: [], projections } }
  }

  const approvalInvocation = (): RemoteEventInvocationFrame => ({
    type: 'waterfall',
    event: 'approval/request',
    eventId: pendingApprovalEventId,
    agentId: sid('fx-alpha'),
    request: {
      toolName: 'dangerous_tool',
      // Pairs the alpha log's open turn-75 call, so the pre-execution block
      // reads through runningCalls (the daypaw approval card's details expander).
      callId: brandString<ToolCallId>('fx-call-approval-live'),
      reason: '清理临时目录 /tmp/build-cache',
    },
  })

  const questionInvocation = (): RemoteEventInvocationFrame => ({
    type: 'waterfall',
    event: 'user-questions/request',
    // fx-gamma, not fx-alpha: the daypaw board's 等待你确认 group keys on the
    // approval badge, and a question badge would shadow it on the run-twinned
    // session (the runtime's badge picks questions first).
    eventId: pendingQuestionEventId,
    agentId: sid('fx-gamma'),
    request: { questions: FIXTURE_QUESTIONS },
  })

  const appendApproval = (id: string, approvalId: string, toolName: string, outcome: NonNullable<ApprovalHistoryEntry['outcome']>): void => {
    append(sid(id), { type: 'approval/asked', data: { id: approvalId, toolName } })
    append(sid(id), { type: 'approval/decided', data: { id: approvalId, outcome } })
  }

  return { mock, appendApproval }
}

/** The active attempt's follow-snapshot baseline member. */
function activeAttemptOf(attempt: {
  readonly attemptId: ReturnType<typeof LlmAttemptId>
  readonly startedAfterSeq: number
  readonly turn: number
  readonly step: number
  readonly index: number
  readonly stream: AssistantStreamAccumulator
}): NonNullable<AssistantStreamBaseline['activeAttempt']> {
  return {
    attemptId: attempt.attemptId,
    startedAfterSeq: attempt.startedAfterSeq,
    turn: attempt.turn,
    step: attempt.step,
    nextIndex: attempt.index,
    stream: attempt.stream.snapshot(),
  }
}

function followedSessionId(value: unknown): SessionId {
  if (!isRecord(value) || !isRecord(value.address)) throw new TypeError('daypaw world follow request is invalid')
  return sid(recordString(value.address, 'sessionId'))
}

function readNumber(value: unknown, key: string, fallback: number): number {
  const selected = isRecord(value) ? value[key] : undefined
  return typeof selected === 'number' ? selected : fallback
}

function recordString(value: unknown, key: string): string {
  const selected = isRecord(value) ? value[key] : undefined
  if (typeof selected !== 'string') throw new TypeError(`daypaw world ${key} must be a string`)
  return selected
}

function optionalRecordString(value: unknown, key: string): string | undefined {
  const selected = isRecord(value) ? value[key] : undefined
  if (selected === undefined) return undefined
  if (typeof selected !== 'string') throw new TypeError(`daypaw world ${key} must be a string`)
  return selected
}

function recordValue(value: unknown, key: string): unknown {
  if (!isRecord(value) || !(key in value)) throw new TypeError(`daypaw world ${key} is missing`)
  return value[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
