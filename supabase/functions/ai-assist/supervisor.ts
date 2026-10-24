/**
 * Workflow Supervisor, AI part (0009): read one job's written record and list
 * contradictions. The rule warnings (amount, photos, returns, reschedules,
 * ratings) are made by the database; this step only adds "AI" warnings. The
 * database gives the input (`supervisor_ai_input`: job text and money, no
 * customer details) and saves the result (`supervisor_save_ai`), which
 * replaces earlier open AI warnings and never touches checked ones.
 */
import { aiFailure, array, askJson, clean, object, string, type JsonAiClient } from './ai.ts'
import { SUPERVISOR_INSTRUCTIONS } from './prompts.ts'

export const SUPERVISOR_TIMEOUT_MS = 25_000
export const MAX_ISSUES = 3
export const MAX_ISSUE_LENGTH = 200

export interface SupervisorInput {
  run_id: string
  order_id: string
  order_no: string
  log_staff_id: string
  job: Record<string, unknown>
  already_checked: { warning: string; manager_note: string }[]
}

export type SaveStatus = 'done' | 'failed' | 'not_set_up'

export interface SupervisorDb {
  /** `supervisor_ai_input` (marks the run running); null when not found or already finished. */
  input(runId: string, requestedBy: string | null): Promise<SupervisorInput | null>
  /** `supervisor_save_ai`. */
  save(runId: string, status: SaveStatus, issues: string[], error: string | null): Promise<void>
}

export interface LogEntry {
  staffId: string
  feature: 'supervisor' | 'form' | 'insights'
  summary: string
  orderId: string | null
  outcome: string
  durationMs: number
  inputTokens: number | null
  outputTokens: number | null
}

export interface AiLog {
  record(entry: LogEntry): Promise<void>
}

export interface SupervisorDeps {
  ai: JsonAiClient | null
  db: SupervisorDb
  log: AiLog
  now(): number
  timeoutMs?: number
}

export interface SupervisorOutcome {
  status: SaveStatus
  warnings: number
}

const ISSUES_SCHEMA = object({
  issues: array(
    object({ message: string('One plain English sentence naming the evidence, at most 200 characters.') }),
    'At most 3 issues; empty when nothing is clearly wrong.',
  ),
})

/** The model's issues, cleaned: strings only, at most 3, each at most 200 characters. */
export function readIssues(value: unknown): string[] {
  const list = (value as { issues?: unknown } | null)?.issues
  if (!Array.isArray(list)) return []
  return list
    .map((item) => clean((item as { message?: unknown } | null)?.message, MAX_ISSUE_LENGTH))
    .filter((m) => m !== '')
    .slice(0, MAX_ISSUES)
}

/** What the model sees: the job record only. */
export function supervisorMessage(input: SupervisorInput): string {
  return JSON.stringify({ job: input.job, already_checked: input.already_checked }, null, 1)
}

/**
 * Run one check. `requestedBy` is the Manager pressing Re-check (null when
 * the database started it with the shared secret). Returns null when the run
 * is not theirs, unknown, or already finished.
 */
export async function runSupervisorCheck(
  runId: string,
  requestedBy: string | null,
  deps: SupervisorDeps,
): Promise<SupervisorOutcome | null> {
  const input = await deps.db.input(runId, requestedBy)
  if (!input) return null
  const started = deps.now()
  const log = (outcome: string, usage: { input_tokens?: number; output_tokens?: number } | null) =>
    deps.log.record({
      staffId: input.log_staff_id,
      feature: 'supervisor',
      summary: `Job check ${input.order_no}`,
      orderId: input.order_id,
      outcome,
      durationMs: Math.round(deps.now() - started),
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
    })

  try {
    const { value, usage } = await askJson(
      deps.ai,
      {
        instructions: SUPERVISOR_INSTRUCTIONS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: supervisorMessage(input) }] }],
        format: { name: 'job_check', schema: ISSUES_SCHEMA },
        maxOutputTokens: 2000,
      },
      deps.timeoutMs ?? SUPERVISOR_TIMEOUT_MS,
    )
    const issues = readIssues(value)
    await deps.db.save(runId, 'done', issues, null)
    await log(issues.length > 0 ? 'warnings' : 'no_warnings', usage)
    return { status: 'done', warnings: issues.length }
  } catch (e) {
    const failure = aiFailure(e)
    const status: SaveStatus = failure === 'not_set_up' ? 'not_set_up' : 'failed'
    const error =
      failure === 'not_set_up'
        ? 'The assistant is not set up yet'
        : failure === 'timeout'
          ? 'The AI check took too long'
          : failure
            ? 'The assistant cannot be reached'
            : 'Something went wrong during the AI check'
    await deps.db.save(runId, status, [], error)
    await log(failure ?? 'error', null)
    if (!failure) throw e
    return { status, warnings: 0 }
  }
}
