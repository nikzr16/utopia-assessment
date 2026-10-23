/**
 * The lookup menu of the `ask` Edge Function (0008): the only things the AI
 * may ask the database for. Each entry has the input schema the AI sees
 * (strict JSON schema), the read function it calls (always as the person
 * asking, so the database applies their branches and role), the columns
 * the AI may see (never phone, address, notes or comments; PRD Q10, Q11),
 * and what the app shows: a table of the full rows, a "How I found this"
 * line, and the function and inputs for Details.
 *
 * Plain TypeScript with no Deno or npm imports, so Vitest tests it.
 */
import {
  PERIOD_KINDS,
  addDays,
  monthStartOf,
  resolvePeriod,
  shiftMonth,
  weekStartOf,
  type PeriodInput,
  type ResolvedPeriod,
} from './periods.ts'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
/** The database as the signed-in person (their token; RLS and rules apply). */
export interface CallerDb {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
}

export type StaffRole = 'admin' | 'manager' | 'finance' | 'technician'

export interface Branch {
  id: string
  name: string
}

/** The person asking (from `current_staff`, plus covered branches for a Manager). */
export interface Person {
  id: string
  name: string
  role: StaffRole
  branchName: string
  /** Branches they may read: every branch, or a Manager's covered ones. */
  visibleBranches: Branch[]
}

export type Row = Record<string, unknown>

export type TableKind = 'summary' | 'technicians' | 'branches' | 'trend' | 'events' | 'jobs' | 'payments'

/** One lookup's records for the app's table (full rows, incl. phone / address for jobs). */
export interface AskTable {
  kind: TableKind
  title: string
  rows: Row[]
  /** All matching rows (rows may be fewer: the lookup's limit). */
  total: number
}

/** "Open in Dashboard" for a KPI answer over a whole week or month. */
export interface DashboardLink {
  view: 'week' | 'month'
  start: string
  branchId: string | null
  technicianId: string | null
}

/** The read function and inputs behind a lookup (for the Question log, never shown in answers). */
export interface LookupDetail {
  lookup: string
  fn: string
  args: Record<string, unknown>
}

/** The lookup ran: data for the AI, a table and lines for the person. */
export interface LookupDone {
  kind: 'done'
  /** What the AI sees (allowed columns only). */
  data: Record<string, unknown>
  table: AskTable
  found: string
  detail: LookupDetail
  rowCount: number
  dashboard: DashboardLink | null
}

/** Stop and tell the person (no AI wording). */
export interface StopReply {
  outcome: 'refused' | 'not_found' | 'clarify'
  answer: string
  options?: string[]
}

export type LookupOutcome =
  | LookupDone
  | { kind: 'stop'; reply: StopReply }
  /** A fixable input problem: told to the AI so it can try again. */
  | { kind: 'retry'; error: string }

export interface LookupContext {
  db: CallerDb
  person: Person
  /** Every branch (names the AI may use). */
  branches: Branch[]
  /** Malaysia day the question was asked. */
  today: string
  /** Called with the step text just before the database read. */
  step: (text: string) => void
}

// ---------------------------------------------------------------------------
// Input schemas (strict mode: every property required, null when unused)
// ---------------------------------------------------------------------------
export interface JsonSchema {
  type: string | string[]
  description?: string
  enum?: (string | null)[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: false
}

const obj = (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const text = (description: string): JsonSchema => ({ type: 'string', description })
const nullableText = (description: string): JsonSchema => ({ type: ['string', 'null'], description })
const choice = (values: readonly string[], description: string): JsonSchema => ({
  type: 'string',
  enum: [...values],
  description,
})
const nullableChoice = (values: readonly string[], description: string): JsonSchema => ({
  type: ['string', 'null'],
  enum: [...values, null],
  description,
})

export const PERIOD_SCHEMA: JsonSchema = obj(
  {
    kind: choice(
      PERIOD_KINDS,
      'A named period (weeks run Monday–Sunday, Malaysia time). Use "month" with month, "range" with start and end, "last_n_days" with n.',
    ),
    n: { type: ['integer', 'null'], description: 'last_n_days only: number of days including today.' },
    month: nullableText('month only: YYYY-MM.'),
    start: nullableText('range only: first day YYYY-MM-DD, as the person typed it.'),
    end: nullableText('range only: last day YYYY-MM-DD (included), as the person typed it.'),
  },
  'The period to look at.',
)
const nullablePeriod = (): JsonSchema => ({ ...PERIOD_SCHEMA, type: ['object', 'null'] })

export const ORDER_STATUSES = [
  'new', 'assigned', 'acknowledged', 'in_progress', 'job_done', 'reviewed', 'closed', 'cancelled',
] as const
const EVENT_KINDS = ['completed', 'rescheduled', 'postponed', 'returned'] as const
const DATE_KINDS = ['scheduled', 'job_done', 'approved', 'created', 'closed'] as const
const PAYMENT_KINDS = ['recorded', 'unverified', 'unpaid', 'partly_paid'] as const

const technicianName = (who: string) =>
  nullableText(`${who} Technician name as the person typed it; null for everyone (or for "me" when a technician asks).`)

/** Check a value against one of our schemas; null when it fits, else where it does not. */
export function checkInput(schema: JsonSchema, value: unknown, path = 'input'): string | null {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (value === null) return types.includes('null') ? null : `${path} is missing`
  if (schema.enum && !schema.enum.includes(value as string)) return `${path} is not one of the allowed values`
  if (types.includes('object') && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties ?? {}
    const v = value as Record<string, unknown>
    for (const key of Object.keys(v)) if (!(key in props)) return `${path}.${key} is not allowed`
    for (const key of schema.required ?? []) {
      if (!(key in v)) return `${path}.${key} is missing`
      const problem = checkInput(props[key], v[key], `${path}.${key}`)
      if (problem) return problem
    }
    return null
  }
  if (types.includes('array') && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const problem = checkInput(schema.items as JsonSchema, value[i], `${path}[${i}]`)
      if (problem) return problem
    }
    return null
  }
  if (types.includes('string') && typeof value === 'string') return null
  if (types.includes('integer') && Number.isInteger(value)) return null
  if (types.includes('boolean') && typeof value === 'boolean') return null
  return `${path} has the wrong type`
}

// ---------------------------------------------------------------------------
// Formatting for the AI
// ---------------------------------------------------------------------------
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000

/** An instant as Malaysia wall-clock time: `2026-10-13 14:05`. */
export function malaysiaDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const t = Date.parse(value)
  if (Number.isNaN(t)) return null
  return new Date(t + MALAYSIA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** Rows the AI may see: allowed columns only, times in Malaysia time, at most 30 rows. */
export const MODEL_ROW_LIMIT = 30
export function forModel(rows: Row[], columns: readonly string[]): Row[] {
  return rows.slice(0, MODEL_ROW_LIMIT).map((row) => {
    const out: Row = {}
    for (const c of columns) {
      if (!(c in row)) continue
      out[c] = c.endsWith('_at') ? malaysiaDateTime(row[c]) : row[c]
    }
    return out
  })
}

/** Columns the AI may see per lookup. Never: ids, phone, address, problem text, notes, comments. */
export const MODEL_COLUMNS = {
  summary: [
    'jobs_completed', 'total_amount', 'collected', 'rescheduled', 'postponed',
    'requested_by_customer', 'requested_by_technician', 'requested_by_admin',
    'reason_customer_not_home', 'reason_parts_unavailable', 'reason_weather',
    'reason_technician_unavailable', 'reason_other', 'returned', 'rated', 'average_rating',
    'poor_ratings', 'active_technicians',
  ],
  technicians: [
    'rank', 'name', 'active', 'branch_name', 'jobs_completed', 'total_amount', 'collected', 'rescheduled',
    'postponed', 'reschedules', 'returned', 'rated', 'average_rating', 'poor_ratings', 'needs_attention',
  ],
  branches: [
    'branch_name', 'jobs_completed', 'total_amount', 'collected', 'rescheduled', 'postponed', 'reschedules',
    'returned', 'rated', 'average_rating', 'poor_ratings', 'active_technicians',
  ],
  trend: ['period_start', 'period_end', 'jobs_completed', 'total_amount', 'reschedules', 'average_rating'],
  events: [
    'kind', 'order_no', 'service_type', 'branch_name', 'happened_at', 'amount', 'rating', 'working_well',
    'reason', 'requested_by',
  ],
  jobs: [
    'order_no', 'status', 'service_type', 'branch_name', 'technician_name', 'technician_active',
    'customer_name', 'scheduled_at', 'created_at', 'job_done_at', 'approved_at', 'closed_at',
    'final_amount', 'amount_paid', 'balance', 'payment_status', 'rating', 'return_count',
  ],
  payments: [
    'kind', 'order_no', 'status', 'branch_name', 'technician_name', 'customer_name', 'amount', 'method',
    'recorded_at', 'verified_at', 'job_done_at', 'final_amount', 'amount_paid', 'balance', 'payment_status',
  ],
} as const satisfies Record<TableKind, readonly string[]>

// ---------------------------------------------------------------------------
// Database refusals the person should read as they are (PRD Q10)
// ---------------------------------------------------------------------------
const OWN_ONLY = 'You can only ask about your own jobs and numbers.'
const PERIOD_ERRORS = [
  'Choose a period of up to a year',
  'The period must end after it starts',
  'Choose a start and an end date',
]

export function coverSentence(person: Person): string {
  const names = person.visibleBranches.map((b) => b.name)
  return `You can only see the branches you cover${names.length ? ` (${names.join(', ')})` : ''}.`
}

/** A database error as a stop (the person reads it), a retry (the AI fixes it), or unexpected. */
export function classifyDbError(message: string, person: Person): LookupOutcome | null {
  if (message.includes('You can only see the branches you cover')) {
    return { kind: 'stop', reply: { outcome: 'refused', answer: coverSentence(person) } }
  }
  if (
    message.includes('You can only see your own') ||
    message.includes('The branch comparison is not available to technicians')
  ) {
    return { kind: 'stop', reply: { outcome: 'refused', answer: OWN_ONLY } }
  }
  const period = PERIOD_ERRORS.find((p) => message.includes(p))
  if (period) return { kind: 'stop', reply: { outcome: 'refused', answer: `${period}.` } }
  if (
    /^(Unknown |Choose a date kind|Choose between|Type part of|Technician not found|Branch not found|Choose week or month)/.test(
      message,
    )
  ) {
    return { kind: 'retry', error: message }
  }
  return null
}

/** Thrown for an unexpected database failure (the person gets a generic message). */
export class LookupFailed extends Error {}

async function read(ctx: LookupContext, fn: string, args: Record<string, unknown>): Promise<Row[] | LookupOutcome> {
  const { data, error } = await ctx.db.rpc(fn, args)
  if (error) {
    const known = classifyDbError(error.message ?? '', ctx.person)
    if (known) return known
    throw new LookupFailed(`${fn}: ${error.message ?? 'unknown error'}`)
  }
  return Array.isArray(data) ? (data as Row[]) : data ? [data as Row] : []
}

// ---------------------------------------------------------------------------
// Inputs shared by several lookups
// ---------------------------------------------------------------------------
interface Who {
  id: string | null
  name: string | null
}

/** A typed technician name → one person (PRD Q7), or a stop. null name = everyone (a technician: themselves). */
async function technician(ctx: LookupContext, typed: string | null): Promise<Who | LookupOutcome> {
  const { person } = ctx
  if (typed === null || typed.trim() === '' || /^(me|myself|saya|aku)$/i.test(typed.trim())) {
    return person.role === 'technician' ? { id: person.id, name: person.name } : { id: null, name: null }
  }
  const rows = await read(ctx, 'ask_find_people', { p_name: typed, p_role: 'technician' })
  if (!Array.isArray(rows)) return rows
  const pick = rows.find((r) => r.is_pick === true)
  if (pick) {
    return { id: pick.id as string, name: `${pick.name as string}${pick.active === false ? ' (inactive)' : ''}` }
  }
  if (person.role === 'technician') return { kind: 'stop', reply: { outcome: 'refused', answer: OWN_ONLY } }
  if (rows.length === 0) {
    const where = person.role === 'manager' ? ' in your branches' : ''
    return { kind: 'stop', reply: { outcome: 'not_found', answer: `No technician named "${typed.trim()}"${where}.` } }
  }
  return {
    kind: 'stop',
    reply: {
      outcome: 'clarify',
      answer: `I found more than one technician called "${typed.trim()}". Which one do you mean?`,
      options: rows
        .slice(0, 4)
        .map((r) => `${r.name as string} (${r.branch_name as string})${r.active === false ? ' (inactive)' : ''}`),
    },
  }
}

interface Where {
  id: string | null
  phrase: string | null
}

function branch(ctx: LookupContext, name: string | null): Where | LookupOutcome {
  if (name === null) {
    const phrase =
      ctx.person.role === 'technician' ? null : ctx.person.role === 'manager' ? 'all your branches' : 'all branches'
    return { id: null, phrase }
  }
  const found = ctx.branches.find((b) => b.name.toLowerCase() === name.trim().toLowerCase())
  if (!found) return { kind: 'retry', error: `Unknown branch: ${name}` }
  return { id: found.id, phrase: found.name }
}

function when(ctx: LookupContext, input: PeriodInput): ResolvedPeriod | LookupOutcome {
  const p = resolvePeriod(input, ctx.today)
  if ('error' in p) return { kind: 'stop', reply: { outcome: 'refused', answer: `${p.error}.` } }
  return p
}

const isOutcome = (v: unknown): v is LookupOutcome =>
  typeof v === 'object' && v !== null && 'kind' in v && ['done', 'stop', 'retry'].includes((v as { kind: string }).kind)

const line = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ')
const found = (what: string, parts: (string | null | undefined)[], count: number, noun = 'found') =>
  `Looked up: ${line([what, ...parts])} · ${count} ${noun}`

const dashboardFor = (p: ResolvedPeriod, branchId: string | null, technicianId: string | null): DashboardLink | null =>
  p.view ? { view: p.view, start: p.start, branchId, technicianId } : null

function done(
  lookup: string,
  fn: string,
  args: Record<string, unknown>,
  kind: TableKind,
  title: string,
  rows: Row[],
  extra: Record<string, unknown>,
  foundLine: string,
  dashboard: DashboardLink | null = null,
): LookupDone {
  const total = rows.length && typeof rows[0].total_count === 'number' ? (rows[0].total_count as number) : rows.length
  return {
    kind: 'done',
    data: { ...extra, total_rows: total, rows_shown: Math.min(rows.length, MODEL_ROW_LIMIT), rows: forModel(rows, MODEL_COLUMNS[kind]) },
    table: { kind, title, rows, total },
    found: foundLine,
    detail: { lookup, fn, args },
    rowCount: total,
    dashboard,
  }
}

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------
export interface Lookup {
  name: string
  description: string
  parameters: JsonSchema
  run(ctx: LookupContext, input: Record<string, unknown>): Promise<LookupOutcome>
}

const branchSchema = (branches: Branch[]) =>
  nullableChoice(
    branches.map((b) => b.name),
    'One branch, or null for every branch the person may see.',
  )

/** The lookups, with branch names from the database. */
export function lookups(branches: Branch[]): Lookup[] {
  const BRANCH = branchSchema(branches)
  return [
    {
      name: 'kpi_summary',
      description:
        'Totals for a period, as on the KPI dashboard cards: jobs completed (approved by a Manager), total amount, collected, reschedules and postponements (by requester and reason), returns for rework, ratings, active technicians.',
      parameters: obj({ period: PERIOD_SCHEMA, branch: BRANCH }),
      async run(ctx, input) {
        const p = when(ctx, input.period as PeriodInput)
        if (isOutcome(p)) return p
        const b = branch(ctx, input.branch as string | null)
        if (isOutcome(b)) return b
        ctx.step(`Looking up totals for ${p.label}…`)
        const args = { p_start: p.start, p_end: p.end, p_branch_id: b.id }
        const rows = await read(ctx, 'kpi_summary', args)
        if (!Array.isArray(rows)) return rows
        return done(
          'kpi_summary', 'kpi_summary', args, 'summary', `Totals — ${p.label}${b.phrase ? `, ${b.phrase}` : ''}`,
          rows, { period: p.label, branch: b.phrase },
          `Looked up: ${line(['totals', b.phrase, p.label])}`,
          dashboardFor(p, b.id, null),
        )
      },
    },
    {
      name: 'technician_leaderboard',
      description:
        'Per-technician numbers for a period, ranked by jobs completed then amount (the KPI leaderboard): jobs completed, amount, collected, reschedules, returns, ratings. Give technician_name to get one technician\'s row. Use it for "who completed the most jobs" and to compare technicians.',
      parameters: obj({ period: PERIOD_SCHEMA, branch: BRANCH, technician_name: technicianName('Optional.') }),
      async run(ctx, input) {
        const p = when(ctx, input.period as PeriodInput)
        if (isOutcome(p)) return p
        const b = branch(ctx, input.branch as string | null)
        if (isOutcome(b)) return b
        const t = await technician(ctx, input.technician_name as string | null)
        if (isOutcome(t)) return t
        ctx.step(`Looking up technician numbers for ${t.name ?? p.label}${t.name ? `, ${p.label}` : ''}…`)
        const args = { p_start: p.start, p_end: p.end, p_branch_id: b.id }
        const all = await read(ctx, 'kpi_technicians', args)
        if (!Array.isArray(all)) return all
        const rows = t.id ? all.filter((r) => r.id === t.id) : all
        return done(
          'technician_leaderboard', 'kpi_technicians', args, 'technicians',
          `Technicians — ${p.label}${b.phrase ? `, ${b.phrase}` : ''}`,
          rows, { period: p.label, branch: b.phrase, technician: t.name },
          found('technician numbers', [t.name, b.phrase, p.label], rows.length, rows.length === 1 ? 'technician' : 'technicians'),
          dashboardFor(p, b.id, null),
        )
      },
    },
    {
      name: 'branch_comparison',
      description: 'One row per branch the person may see for a period: jobs completed, amount, collected, reschedules, returns, ratings, active technicians.',
      parameters: obj({ period: PERIOD_SCHEMA }),
      async run(ctx, input) {
        const p = when(ctx, input.period as PeriodInput)
        if (isOutcome(p)) return p
        ctx.step(`Comparing branches for ${p.label}…`)
        const args = { p_start: p.start, p_end: p.end }
        const rows = await read(ctx, 'kpi_branches', args)
        if (!Array.isArray(rows)) return rows
        return done(
          'branch_comparison', 'kpi_branches', args, 'branches', `Branches — ${p.label}`,
          rows, { period: p.label },
          found('branch comparison', [p.label], rows.length, rows.length === 1 ? 'branch' : 'branches'),
          dashboardFor(p, null, null),
        )
      },
    },
    {
      name: 'trend',
      description:
        'Jobs completed, amount, reschedules and average rating per week or month for the last few periods, oldest first. include_current: true to end with this week / month, false to end with the last complete one.',
      parameters: obj({
        unit: choice(['week', 'month'], 'Weeks (Monday–Sunday) or calendar months.'),
        count: { type: ['integer', 'null'], description: 'How many periods (1–26); null for 8 weeks or 6 months.' },
        include_current: { type: 'boolean', description: 'End with the current week / month.' },
        branch: BRANCH,
        technician_name: technicianName('Optional.'),
      }),
      async run(ctx, input) {
        const unit = input.unit as 'week' | 'month'
        const count = (input.count as number | null) ?? (unit === 'week' ? 8 : 6)
        if (count < 1 || count > 26) return { kind: 'retry', error: 'count must be between 1 and 26' }
        const b = branch(ctx, input.branch as string | null)
        if (isOutcome(b)) return b
        const t = await technician(ctx, input.technician_name as string | null)
        if (isOutcome(t)) return t
        const current = unit === 'week' ? weekStartOf(ctx.today) : monthStartOf(ctx.today)
        const end = input.include_current
          ? unit === 'week' ? addDays(current, 7) : shiftMonth(current, 1)
          : current
        const label = `the ${count} ${unit}s up to ${input.include_current ? `this ${unit}` : `last ${unit}`}`
        ctx.step(`Looking up the trend over ${label}…`)
        const args = { p_unit: unit, p_end: end, p_count: count, p_branch_id: b.id, p_technician_id: t.id }
        const rows = await read(ctx, 'kpi_trend', args)
        if (!Array.isArray(rows)) return rows
        return done(
          'trend', 'kpi_trend', args, 'trend', `Trend — ${label}${t.name ? `, ${t.name}` : ''}`,
          rows, { periods: label, branch: b.phrase, technician: t.name },
          `Looked up: ${line(['trend', t.name, b.phrase, label])}`,
        )
      },
    },
    {
      name: 'technician_events',
      description:
        'The records behind one technician\'s numbers for a period: completed jobs (approved by a Manager, with order number, service type and amount), reschedules, postponements and returns for rework. Use it for "what jobs did Ali complete last week".',
      parameters: obj({
        technician_name: technicianName('Required except for a technician asking about themselves.'),
        period: PERIOD_SCHEMA,
        branch: BRANCH,
        kinds: {
          type: ['array', 'null'],
          items: choice(EVENT_KINDS, 'Record kind.'),
          description: 'Which records; null for all.',
        },
      }),
      async run(ctx, input) {
        const p = when(ctx, input.period as PeriodInput)
        if (isOutcome(p)) return p
        const b = branch(ctx, input.branch as string | null)
        if (isOutcome(b)) return b
        const t = await technician(ctx, input.technician_name as string | null)
        if (isOutcome(t)) return t
        if (!t.id) return { kind: 'retry', error: 'technician_name is required' }
        const kinds = input.kinds as string[] | null
        const what = kinds && kinds.length === 1 ? `${kinds[0]} jobs` : 'jobs and events'
        ctx.step(`Looking up ${what} for ${t.name}, ${p.label}…`)
        const args = { p_technician_id: t.id, p_start: p.start, p_end: p.end, p_branch_id: b.id }
        const all = await read(ctx, 'kpi_technician_events', args)
        if (!Array.isArray(all)) return all
        const rows = kinds && kinds.length ? all.filter((r) => kinds.includes(r.kind as string)) : all
        return done(
          'technician_events', 'kpi_technician_events', args, 'events', `${t.name} — ${p.label}`,
          rows, { technician: t.name, period: p.label, branch: b.phrase, kinds: kinds ?? 'all' },
          found(what, [t.name, b.phrase, p.label], rows.length),
          dashboardFor(p, b.id, t.id),
        )
      },
    },
    {
      name: 'job_list',
      description:
        'Jobs (orders) filtered by technician, branch, status, part of a customer name, payment status, and a date (scheduled, job_done = submitted by the technician, approved = approved by a Manager, created, closed) in a period. Statuses: new, assigned, acknowledged, in_progress, job_done (waiting for review), reviewed (approved), closed, cancelled. Use it for "what is scheduled tomorrow", "jobs waiting for review", "jobs for customer Tan".',
      parameters: obj({
        technician_name: technicianName('Optional.'),
        branch: BRANCH,
        statuses: { type: ['array', 'null'], items: choice(ORDER_STATUSES, 'Order status.'), description: 'null for any status.' },
        customer_name: nullableText('Part of a customer name, or null.'),
        payment_status: nullableChoice(['unpaid', 'partial', 'paid'], 'null for any.'),
        date_kind: nullableChoice(DATE_KINDS, 'Which date the period applies to; null with no period.'),
        period: nullablePeriod(),
      }),
      async run(ctx, input) {
        const dateKind = input.date_kind as string | null
        const periodInput = input.period as PeriodInput | null
        if ((dateKind === null) !== (periodInput === null)) {
          return { kind: 'retry', error: 'Give date_kind and period together, or neither' }
        }
        const p = periodInput ? when(ctx, periodInput) : null
        if (p && isOutcome(p)) return p
        const b = branch(ctx, input.branch as string | null)
        if (isOutcome(b)) return b
        const t = await technician(ctx, input.technician_name as string | null)
        if (isOutcome(t)) return t
        const statuses = input.statuses as string[] | null
        const customer = input.customer_name as string | null
        const dateWords: Record<string, string> = {
          scheduled: 'scheduled', job_done: 'submitted', approved: 'approved', created: 'created', closed: 'closed',
        }
        const parts = [
          statuses && statuses.length ? statuses.join(' / ').replaceAll('_', ' ') : null,
          t.name,
          customer ? `customer "${customer}"` : null,
          (input.payment_status as string | null) ?? null,
          b.phrase,
          p && dateKind ? `${dateWords[dateKind]} ${p.label}` : null,
        ]
        ctx.step(`Looking up jobs${t.name ? ` for ${t.name}` : ''}${p ? `, ${p.label}` : ''}…`)
        const args = {
          p_technician_id: t.id,
          p_branch_id: b.id,
          p_statuses: statuses && statuses.length ? statuses : null,
          p_customer_name: customer,
          p_payment_status: input.payment_status ?? null,
          p_date_kind: dateKind,
          p_start: p?.start ?? null,
          p_end: p?.end ?? null,
          p_limit: 50,
        }
        const rows = await read(ctx, 'ask_jobs', args)
        if (!Array.isArray(rows)) return rows
        const r = done(
          'job_list', 'ask_jobs', args, 'jobs', `Jobs${t.name ? ` — ${t.name}` : ''}${p ? `, ${p.label}` : ''}`,
          rows, { technician: t.name, branch: b.phrase, period: p?.label ?? null, date_kind: dateKind },
          '', null,
        )
        r.found = found('jobs', parts, r.rowCount)
        return r
      },
    },
    {
      name: 'payment_list',
      description:
        'Money: recorded = payments recorded in a period (needs a period); unverified = non-cash receipts not verified by Finance yet; unpaid / partly_paid = finished jobs (Job Done or approved) still owing money (period = Job Done day, optional).',
      parameters: obj({
        kind: choice(PAYMENT_KINDS, 'Which money question.'),
        period: nullablePeriod(),
        branch: BRANCH,
        technician_name: technicianName('Optional.'),
      }),
      async run(ctx, input) {
        const kind = input.kind as (typeof PAYMENT_KINDS)[number]
        const periodInput = input.period as PeriodInput | null
        if (kind === 'recorded' && !periodInput) return { kind: 'retry', error: 'recorded needs a period' }
        const p = periodInput ? when(ctx, periodInput) : null
        if (p && isOutcome(p)) return p
        const b = branch(ctx, input.branch as string | null)
        if (isOutcome(b)) return b
        const t = await technician(ctx, input.technician_name as string | null)
        if (isOutcome(t)) return t
        const words = { recorded: 'payments recorded', unverified: 'receipts not verified', unpaid: 'unpaid jobs', partly_paid: 'partly paid jobs' }
        ctx.step(`Looking up ${words[kind]}${p ? `, ${p.label}` : ''}…`)
        const args = {
          p_kind: kind,
          p_start: p?.start ?? null,
          p_end: p?.end ?? null,
          p_branch_id: b.id,
          p_technician_id: t.id,
          p_limit: 50,
        }
        const rows = await read(ctx, 'ask_payments', args)
        if (!Array.isArray(rows)) return rows
        const r = done(
          'payment_list', 'ask_payments', args, 'payments', `${words[kind][0].toUpperCase()}${words[kind].slice(1)}${p ? ` — ${p.label}` : ''}`,
          rows, { kind, technician: t.name, branch: b.phrase, period: p?.label ?? null },
          '', null,
        )
        r.found = found(words[kind], [t.name, b.phrase, p?.label], r.rowCount)
        return r
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Reply tools: the AI chooses one instead of a lookup; the server words it.
// ---------------------------------------------------------------------------
export const REPLY_TOOLS = [
  {
    name: 'reply_out_of_scope',
    description:
      'Use when the question is not about this company\'s jobs, technicians, payments, reschedules, ratings or returns (weather, general knowledge, writing emails, other companies).',
    parameters: obj({}),
  },
  {
    name: 'reply_cannot_change_data',
    description:
      'Use when the person asks to create, change, assign, reschedule, approve, close, cancel, delete or send anything. You can only look things up.',
    parameters: obj({ order_no: nullableText('The order number they named (e.g. ORDER1234), or null.') }),
  },
  {
    name: 'reply_clarify',
    description:
      'Use when the question is too unclear to look up (e.g. no idea which period or what is being asked). Ask one short question with up to 4 short answer options.',
    parameters: obj({
      question: text('One short question in English.'),
      options: { type: 'array', items: text('A short answer the person can click.'), description: 'Up to 4 options.' },
    }),
  },
] as const satisfies readonly { name: string; description: string; parameters: JsonSchema }[]

export type ReplyToolName = (typeof REPLY_TOOLS)[number]['name']
