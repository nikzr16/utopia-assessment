/**
 * Operational Insight, AI part (0009): word the facts `insight_facts` found.
 * The database finds every fact and number (the same numbers as the KPI
 * dashboard); the AI only rewrites each fact as a sentence and may add one
 * tip. A sentence that uses a number not in its fact is replaced by the fixed
 * sentence; a tip with a strange number is dropped. A wording is saved by a
 * hash of the facts and reused until they change (plan P3).
 *
 * The fixed sentences mirror src/domain/insights.ts (tests/functions/
 * ai-assist.test.ts checks they are identical).
 */
import { aiFailure, array, askJson, clean, integer, nullableString, object, string, type JsonAiClient } from './ai.ts'
import { INSIGHT_INSTRUCTIONS } from './prompts.ts'
import type { AiLog } from './supervisor.ts'

export const INSIGHTS_TIMEOUT_MS = 15_000
export const MAX_SENTENCE_LENGTH = 200
const BACKLOG_DAYS = 2

export type InsightKind = 'busy' | 'quiet' | 'review_backlog' | 'reschedules_up' | 'rating_drop'

export interface InsightFact {
  kind: InsightKind
  technicianId: string | null
  technicianName: string | null
  technicianActive: boolean | null
  branchId: string | null
  branchName: string | null
  value: number
  previous: number | null
  teamAverage: number | null
  days: number | null
}

export interface WordedSentence {
  fact: number
  text: string
  /** False: the fixed sentence (no AI wording, or it failed the number check). */
  ai: boolean
}

export interface Wording {
  sentences: WordedSentence[]
  tip: string | null
  /** 'ai' when worded (now or before), 'fixed' when the AI could not be used. */
  source: 'ai' | 'fixed'
}

export interface SavedWording {
  sentences: { fact: number; text: string }[]
  tip: string | null
}

export interface InsightsDeps {
  ai: JsonAiClient | null
  log: AiLog
  staffId: string
  get(hash: string): Promise<SavedWording | null>
  put(hash: string, wording: SavedWording): Promise<void>
  now(): number
  timeoutMs?: number
}

/** A row of `insight_facts` as the browser and the AI see it. */
export function toFact(row: Record<string, unknown>): InsightFact {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    kind: row.kind as InsightKind,
    technicianId: (row.technician_id as string | null) ?? null,
    technicianName: (row.technician_name as string | null) ?? null,
    technicianActive: (row.technician_active as boolean | null) ?? null,
    branchId: (row.branch_id as string | null) ?? null,
    branchName: (row.branch_name as string | null) ?? null,
    value: Number(row.value),
    previous: n(row.previous),
    teamAverage: n(row.team_average),
    days: n(row.days),
  }
}

// --- Fixed sentences (same as src/domain/insights.ts insightSentence) -------
const one = (n: number) => n.toFixed(1)
const jobs = (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'}`
const person = (f: InsightFact) => `${f.technicianName ?? 'A technician'}${f.technicianActive === false ? ' (inactive)' : ''}`

export function insightSentence(fact: InsightFact, period: string): string {
  switch (fact.kind) {
    case 'busy':
      return `${person(fact)} completed ${jobs(fact.value)} ${period}, well above the team average of ${one(fact.teamAverage ?? 0)}.`
    case 'quiet':
      return `${person(fact)} completed ${jobs(fact.value)} ${period}, well below the team average of ${one(fact.teamAverage ?? 0)}.`
    case 'review_backlog':
      return `${jobs(fact.value)} in ${fact.branchName} ${fact.value === 1 ? 'has' : 'have'} waited more than ${BACKLOG_DAYS} days for a Manager's review (oldest ${fact.days} days).`
    case 'reschedules_up':
      return `${fact.branchName} had ${fact.value} ${fact.value === 1 ? 'reschedule' : 'reschedules'} ${period}, up from ${fact.previous ?? 0} the period before.`
    case 'rating_drop':
      return `${person(fact)}'s average rating fell to ${one(fact.value)} ${period}, from ${one(fact.previous ?? 0)} the period before.`
  }
}

export function insightNumbers(fact: InsightFact): number[] {
  return [fact.value, fact.previous, fact.teamAverage, fact.days, BACKLOG_DAYS].filter(
    (n): n is number => n !== null && n !== undefined,
  )
}

/** Every number written in a text ("1,250.50" counts as 1250.5). */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((m) => Number(m.replace(/,/g, '')))
}

/** True when every number in the text is one of the allowed ones. */
export function usesOnly(text: string, allowed: number[]): boolean {
  return numbersIn(text).every((n) => allowed.some((a) => Math.abs(a - n) < 0.001))
}

export const FIXED_ONLY = (facts: InsightFact[], period: string): Wording => ({
  sentences: facts.map((f, i) => ({ fact: i, text: insightSentence(f, period), ai: false })),
  tip: null,
  source: 'fixed',
})

const WORDING_SCHEMA = object({
  sentences: array(
    object({
      fact: integer('The index of the fact.'),
      text: string('One plain sentence, at most 200 characters, using only that fact’s numbers.'),
    }),
    'One sentence per fact.',
  ),
  tip: nullableString('At most one practical tip, at most 200 characters, or null.'),
})

/** Check the model's wording against the facts; anything that fails falls back. */
export function checkWording(value: unknown, facts: InsightFact[], period: string): SavedWording & { kept: boolean[] } {
  const v = value as { sentences?: unknown; tip?: unknown } | null
  const periodNumbers = numbersIn(period)
  const byFact = new Map<number, string>()
  if (Array.isArray(v?.sentences)) {
    for (const s of v!.sentences as { fact?: unknown; text?: unknown }[]) {
      const i = typeof s?.fact === 'number' ? s.fact : -1
      const text = clean(s?.text, MAX_SENTENCE_LENGTH)
      if (i < 0 || i >= facts.length || byFact.has(i) || text === '') continue
      if (!usesOnly(text, [...insightNumbers(facts[i]), ...periodNumbers])) continue
      byFact.set(i, text)
    }
  }
  const all = [...facts.flatMap(insightNumbers), ...periodNumbers]
  const tip = clean(v?.tip, MAX_SENTENCE_LENGTH)
  return {
    sentences: facts.map((f, i) => ({ fact: i, text: byFact.get(i) ?? insightSentence(f, period) })),
    tip: tip !== '' && usesOnly(tip, all) ? tip : null,
    kept: facts.map((_, i) => byFact.has(i)),
  }
}

/** sha-256 of the facts and the period label, hex. */
export async function wordingHash(facts: InsightFact[], period: string): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify({ v: 1, period, facts }))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Word the facts: a saved wording, a new AI one, or the fixed sentences. */
export async function wordInsights(
  facts: InsightFact[],
  period: string,
  summary: string,
  deps: InsightsDeps,
): Promise<Wording> {
  if (facts.length === 0) return { sentences: [], tip: null, source: 'fixed' }
  const hash = await wordingHash(facts, period)
  const saved = await deps.get(hash)
  if (saved) {
    const checked = checkWording(saved, facts, period)
    return {
      sentences: checked.sentences.map((s, i) => ({ ...s, ai: checked.kept[i] })),
      tip: checked.tip,
      source: 'ai',
    }
  }

  const started = deps.now()
  const message = JSON.stringify(
    {
      period,
      facts: facts.map((f, i) => ({
        index: i,
        kind: f.kind,
        technician: f.technicianName === null ? null : person(f),
        branch: f.branchName,
        numbers: { value: f.value, previous: f.previous, team_average: f.teamAverage, days: f.days },
        sentence: insightSentence(f, period),
      })),
    },
    null,
    1,
  )
  try {
    const { value, usage } = await askJson(
      deps.ai,
      {
        instructions: INSIGHT_INSTRUCTIONS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: message }] }],
        format: { name: 'insight_wording', schema: WORDING_SCHEMA },
        maxOutputTokens: 2000,
      },
      deps.timeoutMs ?? INSIGHTS_TIMEOUT_MS,
    )
    const checked = checkWording(value, facts, period)
    // Only the AI's own sentences are saved; fixed ones are rebuilt on reuse.
    await deps.put(hash, { sentences: checked.sentences.filter((_, i) => checked.kept[i]), tip: checked.tip })
    await deps.log.record({
      staffId: deps.staffId,
      feature: 'insights',
      summary,
      orderId: null,
      outcome: 'worded',
      durationMs: Math.round(deps.now() - started),
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
    })
    return {
      sentences: checked.sentences.map((s, i) => ({ ...s, ai: checked.kept[i] })),
      tip: checked.tip,
      source: 'ai',
    }
  } catch (e) {
    const failure = aiFailure(e)
    await deps.log.record({
      staffId: deps.staffId,
      feature: 'insights',
      summary,
      orderId: null,
      outcome: failure ?? 'error',
      durationMs: Math.round(deps.now() - started),
      inputTokens: null,
      outputTokens: null,
    })
    if (!failure) throw e
    return FIXED_ONLY(facts, period)
  }
}
