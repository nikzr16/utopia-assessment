/**
 * The `ai-assist` Edge Function's logic (0009): three AI steps behind one
 * function, each with its own caller check.
 *
 *   supervisor_check  the database (shared secret, pg_net) at Job Done, or a
 *                     covering Manager pressing Re-check (their run only)
 *   read_form         an Admin's "Read from photo" on the New Order form
 *   word_insights     a Manager or Admin opening the Dashboard Insights card
 *
 * Plain TypeScript with no Deno or npm imports, so Vitest tests it with a
 * fake AI and fake database calls; `index.ts` wires the real ones.
 */
import type { JsonAiClient } from './ai.ts'
import { readOrderForm, type FormFile, type ServiceType } from './formReader.ts'
import { toFact, wordInsights, type SavedWording, type Wording } from './insights.ts'
import { runSupervisorCheck, type AiLog, type SupervisorDb } from './supervisor.ts'

export type StaffRole = 'admin' | 'manager' | 'finance' | 'technician'

export type AiAssistRequest =
  | { action: 'supervisor_check'; runId: string }
  | { action: 'read_form'; file: FormFile }
  | { action: 'word_insights'; start: string; end: string; branchId: string | null; periodLabel: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Longest base64 text of a 10 MB file. */
const MAX_BASE64 = Math.ceil((10 * 1024 * 1024) / 3) * 4 + 16

/** The request, or a plain reason it cannot be used. */
export function parseRequest(body: unknown): AiAssistRequest | string {
  if (!body || typeof body !== 'object') return 'Send a request'
  const b = body as Record<string, unknown>
  switch (b.action) {
    case 'supervisor_check':
      return typeof b.run_id === 'string' && UUID.test(b.run_id)
        ? { action: 'supervisor_check', runId: b.run_id }
        : 'Check not found'
    case 'read_form': {
      const f = b.file as Record<string, unknown> | undefined
      if (!f || typeof f.data !== 'string' || f.data === '') return 'Choose a photo or PDF'
      if (f.data.length > MAX_BASE64) return 'The file can be at most 10 MB'
      return {
        action: 'read_form',
        file: {
          name: typeof f.name === 'string' ? f.name.slice(0, 200) : 'order-form',
          type: typeof f.type === 'string' ? f.type : '',
          data: f.data,
        },
      }
    }
    case 'word_insights': {
      if (typeof b.start !== 'string' || !DAY.test(b.start) || typeof b.end !== 'string' || !DAY.test(b.end)) {
        return 'Choose a start and an end date'
      }
      const branchId = b.branch_id ?? null
      if (branchId !== null && (typeof branchId !== 'string' || !UUID.test(branchId))) return 'Branch not found'
      const label = typeof b.period_label === 'string' ? b.period_label.replace(/\s+/g, ' ').trim() : ''
      if (label === '' || label.length > 60 || /[<>{}]/.test(label)) return 'Name the period'
      return { action: 'word_insights', start: b.start, end: b.end, branchId, periodLabel: label }
    }
    default:
      return 'Unknown request'
  }
}

export const ERROR_MESSAGES = {
  signed_out: 'Your sign-in has expired. Sign in again.',
  error: 'Something went wrong. Try again.',
  not_found: 'This check is no longer waiting. Refresh the page.',
} as const

/** The signed-in person (active staff), if any. */
export interface Caller {
  staffId: string
  role: StaffRole
  branchName: string
}

export interface Context {
  /** The request carried the database's shared secret. */
  trusted: boolean
  caller: Caller | null
  ai: JsonAiClient | null
  log: AiLog
  supervisorDb: SupervisorDb
  serviceTypes(): Promise<ServiceType[]>
  pdfPages(bytes: Uint8Array): Promise<number | null>
  /** `insight_facts` as the caller: rows, or the database's message. */
  insightFacts(start: string, end: string, branchId: string | null): Promise<{ rows: Record<string, unknown>[] } | { error: string }>
  /** Branch name for the log line. */
  branchName(branchId: string): Promise<string | null>
  wordingGet(hash: string): Promise<SavedWording | null>
  wordingPut(hash: string, wording: SavedWording): Promise<void>
  /** Today in Malaysia, YYYY-MM-DD. */
  today: string
  now(): number
}

export interface Reply {
  status: number
  body: Record<string, unknown>
}

const fail = (status: number, code: string, message: string): Reply => ({ status, body: { error: { code, message } } })

/** Database refusals shown to the person as they are (the rest go to the log only). */
const SAFE_DB_MESSAGES = [
  'Insights are for Managers and Admins',
  'You can only see the branches you cover',
  'Branch not found',
  'Choose a start and an end date',
  'The period must end after it starts',
  'Choose a period of up to a year',
]

export async function handleAiAssist(request: AiAssistRequest, ctx: Context): Promise<Reply> {
  switch (request.action) {
    case 'supervisor_check': {
      let requestedBy: string | null = null
      if (!ctx.trusted) {
        if (!ctx.caller) return fail(401, 'signed_out', ERROR_MESSAGES.signed_out)
        if (ctx.caller.role !== 'manager') return fail(403, 'forbidden', 'Only a Manager can re-check a job')
        requestedBy = ctx.caller.staffId
      }
      const outcome = await runSupervisorCheck(request.runId, requestedBy, {
        ai: ctx.ai,
        db: ctx.supervisorDb,
        log: ctx.log,
        now: ctx.now,
      })
      if (!outcome) return fail(404, 'not_found', ERROR_MESSAGES.not_found)
      return { status: 200, body: { status: outcome.status, warnings: outcome.warnings } }
    }

    case 'read_form': {
      if (!ctx.caller) return fail(401, 'signed_out', ERROR_MESSAGES.signed_out)
      if (ctx.caller.role !== 'admin') return fail(403, 'forbidden', 'Only Admins can read order forms')
      const result = await readOrderForm(request.file, {
        ai: ctx.ai,
        log: ctx.log,
        staffId: ctx.caller.staffId,
        serviceTypes: await ctx.serviceTypes(),
        pdfPages: ctx.pdfPages,
        today: ctx.today,
        now: ctx.now,
      })
      return result.ok
        ? { status: 200, body: { fields: result.fields } }
        : { status: 200, body: { error: { code: result.code, message: result.message } } }
    }

    case 'word_insights': {
      if (!ctx.caller) return fail(401, 'signed_out', ERROR_MESSAGES.signed_out)
      if (ctx.caller.role !== 'admin' && ctx.caller.role !== 'manager') {
        return fail(403, 'forbidden', 'Insights are for Managers and Admins')
      }
      const facts = await ctx.insightFacts(request.start, request.end, request.branchId)
      if ('error' in facts) {
        const safe = SAFE_DB_MESSAGES.find((m) => facts.error.includes(m))
        if (!safe) throw new Error(`insight_facts: ${facts.error}`)
        return fail(400, 'refused', safe)
      }
      const list = facts.rows.map(toFact)
      const where = request.branchId ? ((await ctx.branchName(request.branchId)) ?? 'one branch') : 'all your branches'
      const wording: Wording = await wordInsights(list, request.periodLabel, `Insights · ${request.periodLabel} · ${where}`, {
        ai: ctx.ai,
        log: ctx.log,
        staffId: ctx.caller.staffId,
        get: ctx.wordingGet,
        put: ctx.wordingPut,
        now: ctx.now,
      })
      return { status: 200, body: { facts: list, ...wording } }
    }
  }
}
