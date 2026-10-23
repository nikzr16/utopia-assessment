import type { StaffRole } from '../../domain'
import { client, run, toNumber } from '../../lib/api'

export { ApiError } from '../../lib/api'

/**
 * Every database call the KPI dashboard makes (0007): the five read-only
 * `kpi_*` functions, which compute every number and scope it to what the
 * signed-in person may see. This module only calls them and turns numeric
 * columns into numbers. Each function throws an `ApiError` with a message that
 * can be shown as it is.
 *
 * Periods are Malaysia calendar days as `YYYY-MM-DD`; `end` is exclusive (use
 * `periodRange` from the domain). `branchId` null means every branch the
 * person may see.
 */

export const RESCHEDULE_REASONS = [
  'customer_not_home',
  'parts_unavailable',
  'weather',
  'technician_unavailable',
  'other',
] as const
export type RescheduleReason = (typeof RESCHEDULE_REASONS)[number]

export const RESCHEDULE_PARTIES = ['customer', 'technician', 'admin'] as const
export type ReschedulePartyName = (typeof RESCHEDULE_PARTIES)[number]

/** Reschedules and postponements by reason, then by who asked. */
export type ReasonByRequester = Record<RescheduleReason, Record<ReschedulePartyName, number>>

/** The metrics every row shares (`kpi_summary`, `kpi_technicians`, `kpi_branches`). */
export interface KpiMetrics {
  /** Jobs a Manager approved in the period (still Reviewed or Closed). */
  jobs_completed: number
  /** Final amount (quoted price + extra charges) of those jobs, MYR. */
  total_amount: number
  /** Payments recorded in the period, MYR. */
  collected: number
  /** Reschedule log rows with a new date. */
  rescheduled: number
  /** Reschedule log rows without a date. */
  postponed: number
  returned: number
  /** Completed jobs that have a rating (latest rating per order). */
  rated: number
  /** 1 to 5 with one decimal; null when nothing is rated. */
  average_rating: number | null
  /** 1-2 stars or "not working well". */
  poor_ratings: number
}

/** `kpi_summary`: the cards. */
export interface KpiSummary extends KpiMetrics {
  requested_by_customer: number
  requested_by_technician: number
  requested_by_admin: number
  reason_customer_not_home: number
  reason_parts_unavailable: number
  reason_weather: number
  reason_technician_unavailable: number
  reason_other: number
  reason_by_requester: ReasonByRequester
  /** Technicians active in the scope at the end of the period. */
  active_technicians: number
}

/** `kpi_technicians`: one leaderboard row. */
export interface KpiTechnicianRow extends KpiMetrics {
  id: string
  name: string
  /** Active now; false shows "(inactive)". */
  active: boolean
  /** Home branch now. */
  branch_id: string
  branch_name: string
  /** rescheduled + postponed. */
  reschedules: number
  requested_by_customer: number
  requested_by_technician: number
  requested_by_admin: number
  reason_customer_not_home: number
  reason_parts_unavailable: number
  reason_weather: number
  reason_technician_unavailable: number
  reason_other: number
  /** Competition rank (1, 1, 3); null for a technician's own view. */
  rank: number | null
  /** 3 or more returns in the period. */
  needs_attention: boolean
}

/** `kpi_branches`: one row per visible branch. */
export interface KpiBranchRow extends KpiMetrics {
  branch_id: string
  branch_name: string
  reschedules: number
  active_technicians: number
}

/** `kpi_trend`: one week or month. */
export interface KpiTrendPoint {
  period_start: string
  /** Exclusive. */
  period_end: string
  jobs_completed: number
  total_amount: number
  reschedules: number
  average_rating: number | null
}

export type KpiEventKind = 'completed' | 'rescheduled' | 'postponed' | 'returned'

/** `kpi_technician_events`: a row behind a technician's numbers. */
export interface KpiEvent {
  kind: KpiEventKind
  order_id: string
  order_no: string
  service_type: string
  branch_id: string
  branch_name: string
  /** Approval, reschedule or return time. */
  happened_at: string
  /** Final amount; completed rows only. */
  amount: number | null
  rating: number | null
  working_well: boolean | null
  reason: RescheduleReason | null
  requested_by: ReschedulePartyName | null
  note: string | null
}

export interface KpiBranchOption {
  id: string
  name: string
}

const nullableNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Counts and money arrive as numbers or strings; make them numbers. */
function metrics<T extends object>(row: T): T {
  const r = row as Record<string, unknown>
  return {
    ...row,
    total_amount: toNumber(r.total_amount),
    collected: toNumber(r.collected),
    average_rating: nullableNumber(r.average_rating),
  }
}

export async function fetchKpiSummary(start: string, end: string, branchId: string | null): Promise<KpiSummary> {
  const rows = (await run(
    client().rpc('kpi_summary', { p_start: start, p_end: end, p_branch_id: branchId }),
  )) as KpiSummary[] | null
  return metrics(rows![0])
}

export async function fetchKpiTechnicians(start: string, end: string, branchId: string | null): Promise<KpiTechnicianRow[]> {
  const rows = (await run(
    client().rpc('kpi_technicians', { p_start: start, p_end: end, p_branch_id: branchId }),
  )) as KpiTechnicianRow[] | null
  return (rows ?? []).map((r) => ({ ...metrics(r), rank: nullableNumber(r.rank) }))
}

/** Branch comparison; Admins, Finance and Managers only (a technician is refused). */
export async function fetchKpiBranches(start: string, end: string): Promise<KpiBranchRow[]> {
  const rows = (await run(client().rpc('kpi_branches', { p_start: start, p_end: end }))) as KpiBranchRow[] | null
  return (rows ?? []).map(metrics)
}

/**
 * The trend ending before `end` (exclusive): the last row is the week or
 * month holding the day before it. `technicianId` narrows to one technician.
 */
export async function fetchKpiTrend(
  unit: 'week' | 'month',
  end: string,
  count: number,
  branchId: string | null,
  technicianId: string | null = null,
): Promise<KpiTrendPoint[]> {
  const rows = (await run(
    client().rpc('kpi_trend', {
      p_unit: unit,
      p_end: end,
      p_count: count,
      p_branch_id: branchId,
      p_technician_id: technicianId,
    }),
  )) as KpiTrendPoint[] | null
  return (rows ?? []).map((r) => ({ ...metrics(r), period_start: r.period_start, period_end: r.period_end }))
}

export async function fetchKpiTechnicianEvents(
  technicianId: string,
  start: string,
  end: string,
  branchId: string | null,
): Promise<KpiEvent[]> {
  const rows = (await run(
    client().rpc('kpi_technician_events', {
      p_technician_id: technicianId,
      p_start: start,
      p_end: end,
      p_branch_id: branchId,
    }),
  )) as KpiEvent[] | null
  return (rows ?? []).map((r) => ({ ...r, amount: nullableNumber(r.amount), rating: nullableNumber(r.rating) }))
}

/**
 * The branches the branch filter offers: every branch for Admins and Finance,
 * the covered ones for a Manager, none for a technician.
 */
export async function fetchKpiBranchOptions(role: StaffRole): Promise<KpiBranchOption[]> {
  if (role === 'technician') return []
  if (role === 'manager') return ((await run(client().rpc('covered_branches'))) as KpiBranchOption[]) ?? []
  return ((await run(client().from('branches').select('id, name').order('name'))) as KpiBranchOption[]) ?? []
}
