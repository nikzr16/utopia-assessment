/**
 * The `ask` Edge Function's logic (0008): one question in, one answer out.
 *
 *   question → the AI picks lookups from the menu (lookups.ts) → the server
 *   checks each input and runs it in the database as the person asking →
 *   the rows go back to the AI → it writes one or two sentences → the app
 *   shows them with a table of the full rows and "How I found this".
 *
 * At most 3 lookups per question. Limits (out of scope, a request to change
 * data, an unclear question, another branch, an unknown or ambiguous name)
 * end in fixed sentences, never AI wording. Each step is sent to the browser
 * as it starts. The question, answer and result are saved in the person's
 * chat and a Question log entry is written through `record` (the secret-key
 * client, P3); failed attempts are logged but not saved in the chat.
 *
 * Plain TypeScript with no Deno or npm imports, so Vitest tests it with a
 * fake AI and a fake database; `index.ts` wires the real ones.
 */
import {
  LookupFailed,
  REPLY_TOOLS,
  checkInput,
  lookups,
  type AskTable,
  type Branch,
  type CallerDb,
  type DashboardLink,
  type JsonSchema,
  type LookupContext,
  type LookupDone,
  type Person,
  type StaffRole,
  type StopReply,
} from './lookups.ts'
import { malaysiaToday } from './periods.ts'
import { INSTRUCTIONS, contextMessage } from './prompt.ts'

export const MAX_LOOKUPS = 3
/** AI calls per question: lookups in up to 3 rounds, then the answer. */
export const MAX_AI_CALLS = 4
export const MAX_QUESTION_LENGTH = 1000
/** Earlier questions and answers sent with a follow-up (P6). */
export const TURNS_SENT = 5
/** The server gives up before the browser's 20-second limit. */
export const DEFAULT_TIMEOUT_MS = 18_000
const MAX_ANSWER_LENGTH = 800

// ---------------------------------------------------------------------------
// The AI client: the part of OpenAI's Responses API this function uses.
// ---------------------------------------------------------------------------
export interface AiFunctionTool {
  type: 'function'
  name: string
  description: string
  parameters: JsonSchema
  strict: true
}

/** A message, an earlier output item passed back as it came, or a tool result. */
export type AiInputItem = Record<string, unknown>

export interface AiOutputItem {
  type: string
  [key: string]: unknown
}

export interface AiRequest {
  instructions: string
  input: AiInputItem[]
  tools: AiFunctionTool[]
  toolChoice: 'auto' | 'none'
}

export interface AiResponse {
  output: AiOutputItem[]
  usage?: { input_tokens?: number; output_tokens?: number } | null
}

export interface AiClient {
  respond(request: AiRequest, signal: AbortSignal): Promise<AiResponse>
}

/** The AI service refused the key (not set up) or could not answer. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_set_up' | 'unavailable',
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Request, result, events
// ---------------------------------------------------------------------------
export interface AskRequest {
  question: string
  chatId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The browser's request, or a plain-language reason it cannot be used. */
export function parseAskRequest(body: unknown): AskRequest | string {
  if (!body || typeof body !== 'object') return 'Send a question'
  const b = body as Record<string, unknown>
  if (typeof b.question !== 'string' || b.question.trim() === '') return 'Type a question'
  const question = b.question.trim()
  if (question.length > MAX_QUESTION_LENGTH) return `Keep the question to ${MAX_QUESTION_LENGTH} characters`
  const chatId = b.chatId ?? null
  if (chatId !== null && (typeof chatId !== 'string' || !UUID.test(chatId))) return 'Chat not found'
  return { question, chatId }
}

export type AskResultKind = 'answer' | 'clarify' | 'out_of_scope' | 'cannot_change' | 'refused' | 'not_found'

/** What the browser shows under the question (also saved with the chat). */
export interface AskResult {
  kind: AskResultKind
  answer: string
  tables: AskTable[]
  /** "How I found this" lines, one per lookup, in plain words (no function names or inputs). */
  found: string[]
  /** Buttons that send their text as the next question (Did you mean…?, clarify). */
  options: string[]
  /** The order named in a request to change data (the reply links to it). */
  orderNo: string | null
  dashboard: DashboardLink | null
}

export type AskErrorCode =
  | 'bad_request'
  | 'signed_out'
  | 'chat_not_found'
  | 'not_set_up'
  | 'ai_unavailable'
  | 'timeout'
  | 'error'

export type AskEvent =
  | { type: 'step'; text: string }
  | { type: 'result'; chatId: string | null; messageId: number | null; result: AskResult }
  | { type: 'error'; code: AskErrorCode; message: string }

export const ERROR_MESSAGES: Record<AskErrorCode, string> = {
  bad_request: 'Type a question',
  signed_out: 'Your sign-in has expired. Sign in again.',
  chat_not_found: 'This chat is no longer available. Start a new chat.',
  not_set_up: 'The assistant is not set up yet.',
  ai_unavailable:
    "The assistant can't be reached right now. Try again in a minute, or open the Dashboard for the same numbers.",
  timeout: 'This is taking too long. Try again.',
  error: 'Something went wrong while answering. Try again.',
}

export type LogOutcome =
  | 'answered'
  | 'no_data'
  | 'clarify'
  | 'out_of_scope'
  | 'cannot_change'
  | 'refused'
  | 'not_found'
  | 'ai_unavailable'
  | 'not_set_up'
  | 'timeout'
  | 'error'

/** One question for `ask_record`: the Question log entry, and the chat turn when `save`. */
export interface RecordEntry {
  staffId: string
  chatId: string | null
  question: string
  answer: string | null
  result: AskResult | null
  save: boolean
  lookups: Record<string, unknown>[]
  rowCount: number
  outcome: LogOutcome
  durationMs: number
  inputTokens: number
  outputTokens: number
}

/** An earlier turn of the chat (newest last). */
export interface Turn {
  role: 'user' | 'assistant'
  body: string
  found: string[]
}

export interface AskDeps {
  /** The database as the person asking. */
  db: CallerDb
  /** null when the AI key is not set. */
  ai: AiClient | null
  /** Every branch (id, name). */
  branches(): Promise<Branch[]>
  /** The chat's turns, oldest first; null when it is not the person's (or older than 7 days). */
  turns(chatId: string): Promise<Turn[] | null>
  /** Save through `ask_record` (secret key). */
  record(entry: RecordEntry): Promise<{ chatId: string | null; messageId: number | null }>
  emit(event: AskEvent): void
  log(message: string): void
  now(): Date
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// The person asking
// ---------------------------------------------------------------------------
/** The signed-in person's active staff profile, or null. */
export async function loadPerson(db: CallerDb, branches: Branch[]): Promise<Person | null> {
  const me = await db.rpc('current_staff', {})
  const row = Array.isArray(me.data) ? (me.data[0] as Record<string, unknown> | undefined) : undefined
  if (me.error || !row || row.active === false) return null
  const role = row.role as StaffRole
  let visible = branches
  if (role === 'manager') {
    const cover = await db.rpc('covered_branches', {})
    if (cover.error || !Array.isArray(cover.data)) return null
    visible = (cover.data as { id: string; name: string }[]).map((b) => ({ id: b.id, name: b.name }))
  }
  return {
    id: row.id as string,
    name: row.name as string,
    role,
    branchName: row.branch_name as string,
    visibleBranches: visible,
  }
}

// ---------------------------------------------------------------------------
// Fixed replies
// ---------------------------------------------------------------------------
export const OUT_OF_SCOPE_ANSWER =
  'I can only answer questions about jobs, technicians, payments, reschedules, ratings and returns. Try one of these:'

function cannotChange(orderNo: string | null): string {
  return orderNo
    ? `I can only look things up. To change an order, open it: ${orderNo}.`
    : 'I can only look things up. To change an order, open it in your portal.'
}

const emptyResult = (kind: AskResultKind, answer: string): AskResult => ({
  kind,
  answer,
  tables: [],
  found: [],
  options: [],
  orderNo: null,
  dashboard: null,
})

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** The answer text of a response: the last message's output text. */
export function outputText(output: AiOutputItem[]): string {
  const messages = output.filter((o) => o.type === 'message')
  const last = messages[messages.length - 1]
  if (!last || !Array.isArray(last.content)) return ''
  return (last.content as { type?: string; text?: string }[])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('')
    .trim()
}

const toTool = (t: { name: string; description: string; parameters: JsonSchema }): AiFunctionTool => ({
  type: 'function',
  name: t.name,
  description: t.description,
  parameters: t.parameters,
  strict: true,
})

// ---------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------
export async function handleAsk(request: AskRequest, deps: AskDeps): Promise<void> {
  const started = deps.now().getTime()
  const usage = { input: 0, output: 0 }
  const logLookups: Record<string, unknown>[] = []
  const done: LookupDone[] = []
  let used = 0

  const branches = await deps.branches()
  const person = await loadPerson(deps.db, branches)
  if (!person) {
    deps.emit({ type: 'error', code: 'signed_out', message: ERROR_MESSAGES.signed_out })
    return
  }

  const fail = async (code: AskErrorCode, outcome: LogOutcome) => {
    await save(null, outcome, false)
    deps.emit({ type: 'error', code, message: ERROR_MESSAGES[code] })
  }

  async function save(result: AskResult | null, outcome: LogOutcome, keep: boolean) {
    try {
      return await deps.record({
        staffId: person!.id,
        chatId: request.chatId,
        question: request.question,
        answer: result?.answer ?? null,
        result,
        save: keep,
        lookups: logLookups,
        rowCount: done.reduce((n, d) => n + d.rowCount, 0),
        outcome,
        durationMs: deps.now().getTime() - started,
        inputTokens: usage.input,
        outputTokens: usage.output,
      })
    } catch (e) {
      deps.log(`record failed: ${(e as Error).message}`)
      return { chatId: request.chatId, messageId: null }
    }
  }

  const finish = async (result: AskResult, outcome: LogOutcome) => {
    const saved = await save(result, outcome, true)
    deps.emit({ type: 'result', chatId: saved.chatId, messageId: saved.messageId, result })
  }

  if (!deps.ai) return fail('not_set_up', 'not_set_up')

  let turns: Turn[] = []
  if (request.chatId) {
    const found = await deps.turns(request.chatId)
    if (!found) {
      deps.emit({ type: 'error', code: 'chat_not_found', message: ERROR_MESSAGES.chat_not_found })
      return
    }
    turns = found.slice(-TURNS_SENT * 2)
  }

  const today = malaysiaToday(deps.now())
  const menu = lookups(branches)
  const tools = [...menu.map(toTool), ...REPLY_TOOLS.map(toTool)]
  const ctx: LookupContext = {
    db: deps.db,
    person,
    branches,
    today,
    step: (text) => deps.emit({ type: 'step', text }),
  }

  let input: AiInputItem[] = [
    { role: 'developer', content: contextMessage(person, today, branches) },
    ...turns.map((t) => ({
      role: t.role,
      content: t.role === 'assistant' && t.found.length ? `${t.body}\n(${t.found.join('; ')})` : t.body,
    })),
    { role: 'user', content: request.question },
  ]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  deps.emit({ type: 'step', text: 'Understanding your question…' })

  try {
    let answer = ''
    for (let call = 0; call < MAX_AI_CALLS; call++) {
      const toolChoice = used >= MAX_LOOKUPS || call === MAX_AI_CALLS - 1 ? 'none' : 'auto'
      if (call > 0) deps.emit({ type: 'step', text: 'Writing the answer…' })
      const response = await deps.ai.respond({ instructions: INSTRUCTIONS, input, tools, toolChoice }, controller.signal)
      usage.input += response.usage?.input_tokens ?? 0
      usage.output += response.usage?.output_tokens ?? 0

      const calls = response.output.filter((o) => o.type === 'function_call')
      if (calls.length === 0 || toolChoice === 'none') {
        answer = outputText(response.output)
        break
      }

      // A reply tool ends the question with a fixed sentence.
      const reply = calls.find((c) => REPLY_TOOLS.some((r) => r.name === c.name))
      if (reply) {
        const args = parseArgs(reply.arguments)
        logLookups.push({ lookup: reply.name, input: args, status: 'reply' })
        if (reply.name === 'reply_out_of_scope') {
          return await finish(emptyResult('out_of_scope', OUT_OF_SCOPE_ANSWER), 'out_of_scope')
        }
        if (reply.name === 'reply_cannot_change_data') {
          const named = typeof args?.order_no === 'string' ? args.order_no.trim().toUpperCase() : ''
          const orderNo = /^ORDER\d{1,12}$/.test(named) ? named : null
          return await finish({ ...emptyResult('cannot_change', cannotChange(orderNo)), orderNo }, 'cannot_change')
        }
        const question = typeof args?.question === 'string' && args.question.trim() ? args.question.trim() : 'What do you mean?'
        const options = Array.isArray(args?.options)
          ? (args.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim() !== '').slice(0, 4)
          : []
        return await finish(
          { ...emptyResult('clarify', clip(question, 200)), options: options.map((o) => clip(o.trim(), 60)) },
          'clarify',
        )
      }

      input = [...input, ...response.output]
      for (const c of calls) {
        const output = await runCall(c)
        if ('stop' in output) {
          const r = output.stop
          return await finish({ ...emptyResult(r.outcome, r.answer), options: r.options ?? [] }, r.outcome)
        }
        input.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(output.data) })
      }
    }

    if (!answer) {
      deps.log('the AI returned no answer text')
      return await fail('error', 'error')
    }
    const result: AskResult = {
      kind: 'answer',
      answer: clip(answer, MAX_ANSWER_LENGTH),
      tables: done.map((d) => d.table),
      found: done.map((d) => d.found),
      options: [],
      orderNo: null,
      dashboard: done.find((d) => d.dashboard)?.dashboard ?? null,
    }
    const noData = done.length > 0 && done.every((d) => d.table.kind !== 'summary' && d.rowCount === 0)
    return await finish(result, noData ? 'no_data' : 'answered')
  } catch (e) {
    if (controller.signal.aborted) return await fail('timeout', 'timeout')
    if (e instanceof AiError) {
      deps.log(`AI: ${e.message}`)
      return await fail(e.kind === 'not_set_up' ? 'not_set_up' : 'ai_unavailable', e.kind === 'not_set_up' ? 'not_set_up' : 'ai_unavailable')
    }
    deps.log(e instanceof LookupFailed ? `lookup: ${e.message}` : `unexpected: ${(e as Error).message}`)
    return await fail('error', 'error')
  } finally {
    clearTimeout(timer)
  }

  /** Run one lookup call: data for the AI, or a stop for the person. */
  async function runCall(c: AiOutputItem): Promise<{ data: unknown } | { stop: StopReply }> {
    const name = String(c.name)
    const lookup = menu.find((l) => l.name === name)
    const args = parseArgs(c.arguments)
    if (!lookup) {
      logLookups.push({ lookup: name, input: args, status: 'rejected' })
      return { data: { error: `Unknown lookup: ${name}` } }
    }
    if (used >= MAX_LOOKUPS) {
      logLookups.push({ lookup: name, input: args, status: 'rejected' })
      return { data: { error: `You have used the ${MAX_LOOKUPS} lookups for this question. Answer with what you have.` } }
    }
    const problem = args ? checkInput(lookup.parameters, args) : 'input is not valid JSON'
    if (problem || !args) {
      logLookups.push({ lookup: name, input: args, status: 'rejected' })
      return { data: { error: problem } }
    }
    used++
    const outcome = await lookup.run(ctx, args)
    if (outcome.kind === 'done') {
      done.push(outcome)
      logLookups.push({ lookup: name, input: args, status: 'done', fn: outcome.detail.fn, rows: outcome.rowCount })
      return { data: outcome.data }
    }
    if (outcome.kind === 'retry') {
      logLookups.push({ lookup: name, input: args, status: 'retry', error: outcome.error })
      return { data: { error: outcome.error } }
    }
    logLookups.push({ lookup: name, input: args, status: outcome.reply.outcome })
    return { stop: outcome.reply }
  }
}

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
