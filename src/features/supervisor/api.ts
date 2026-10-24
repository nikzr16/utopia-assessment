import type { SupervisorRunStatus, WarningRule, WarningStatus } from '../../domain'
import { client, run } from '../../lib/api'
import { callAiAssist } from '../../lib/aiAssist'

export { ApiError } from '../../lib/api'

/**
 * Workflow Supervisor (0009): an order's warnings and its latest AI check.
 * Reads run under row-level security (Admins, Finance and covering Managers;
 * technicians see none); checking a warning and asking for a re-check go
 * through RPCs; the re-check itself runs in the `ai-assist` Edge Function.
 */
export interface OrderWarning {
  id: string
  order_id: string
  seq: number
  rule: WarningRule
  source: 'rule' | 'ai'
  message: string
  status: WarningStatus
  opened_at: string
  checked_by: string | null
  checked_by_name: string | null
  checked_at: string | null
  check_note: string | null
}

export interface SupervisorRun {
  id: string
  status: SupervisorRunStatus
  trigger: 'job_done' | 'resubmitted' | 'recheck'
  created_at: string
  finished_at: string | null
}

export interface OrderWarnings {
  /** Open and checked warnings, in the order they were raised. */
  warnings: OrderWarning[]
  /** The latest AI check, if any. */
  run: SupervisorRun | null
}

export async function fetchOrderWarnings(orderId: string): Promise<OrderWarnings> {
  const [rows, runs] = await Promise.all([
    run(
      client()
        .from('order_warnings')
        .select('id, order_id, seq, rule, source, message, status, opened_at, checked_by, checked_at, check_note, checker:staff!order_warnings_checked_by_fkey(name)')
        .eq('order_id', orderId)
        .neq('status', 'resolved')
        .order('seq'),
    ),
    run(
      client()
        .from('supervisor_runs')
        .select('id, status, trigger, created_at, finished_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1),
    ),
  ])
  return {
    warnings: (rows as Record<string, unknown>[]).map((r) => ({
      ...(r as unknown as OrderWarning),
      seq: Number(r.seq),
      checked_by_name: ((r.checker as { name?: string } | null)?.name as string | undefined) ?? null,
    })),
    run: ((runs as SupervisorRun[])[0] as SupervisorRun | undefined) ?? null,
  }
}

/** Open warnings per order (for the Manager's review list). */
export async function fetchOpenWarningCounts(orderIds: string[]): Promise<Record<string, number>> {
  if (orderIds.length === 0) return {}
  const rows = await run(
    client().from('order_warnings').select('order_id').in('order_id', orderIds).eq('status', 'open'),
  )
  const counts: Record<string, number> = {}
  for (const r of rows as { order_id: string }[]) counts[r.order_id] = (counts[r.order_id] ?? 0) + 1
  return counts
}

export async function checkWarning(warningId: string, note: string): Promise<void> {
  await run(client().rpc('check_order_warning', { p_warning_id: warningId, p_note: note }))
}

/** Ask for a fresh AI check and run it (a covering Manager). */
export async function recheckOrder(orderId: string): Promise<void> {
  const created = (await run(client().rpc('request_supervisor_recheck', { p_order_id: orderId }))) as { id: string }
  await callAiAssist({ action: 'supervisor_check', run_id: created.id }, 40_000)
}

/** Live changes to an order's warnings and AI checks; returns the unsubscribe. */
export function subscribeToWarnings(orderId: string, onChange: () => void): () => void {
  const db = client()
  const channel = db
    .channel(`warnings:${orderId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_warnings', filter: `order_id=eq.${orderId}` }, () =>
      onChange(),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supervisor_runs', filter: `order_id=eq.${orderId}` }, () =>
      onChange(),
    )
    .subscribe()
  return () => {
    void db.removeChannel(channel)
  }
}
