import type { AttachmentKind, PaymentMethod } from '../domain'
import { client, run, toNumber } from './api'

/**
 * What hangs off an order after work starts: the completion record, the
 * payments (with their receipts) and the latest rework note. Read by the
 * Technician job page and the Admin order detail, under row-level security.
 */

/** The submitted completion record (`order_completions`). */
export interface Completion {
  work_done: string
  extra_charges: number
  remarks: string | null
  completed_at: string
  technician_name: string
}

export interface Payment {
  id: string
  amount: number
  method: PaymentMethod
  note: string | null
  recorded_at: string
  recorded_by_name: string
  receipt: { id: string; kind: AttachmentKind; storage_path: string; file_name: string | null } | null
}

/** The latest "returned for rework" entry from the audit log. */
export interface ReworkNote {
  note: string
  by: string
  at: string
}

export interface OrderRecords {
  completion: Completion | null
  payments: Payment[]
  rework: ReworkNote | null
}

const nameOf = (embedded: unknown): string => {
  const row = Array.isArray(embedded) ? embedded[0] : embedded
  return (row as { name?: string } | null)?.name ?? 'Unknown'
}

export async function fetchOrderRecords(orderId: string): Promise<OrderRecords> {
  const db = client()
  const [completions, payments, reworks] = await Promise.all([
    run(
      db
        .from('order_completions')
        .select('work_done, extra_charges, remarks, completed_at, technician:staff!order_completions_technician_id_fkey(name)')
        .eq('order_id', orderId)
        .limit(1),
    ),
    run(
      db
        .from('payments')
        .select(
          'id, amount, method, note, recorded_at, recorder:staff!payments_recorded_by_fkey(name), receipt:attachments!attachments_payment_id_fkey(id, kind, storage_path, file_name)',
        )
        .eq('order_id', orderId)
        .order('recorded_at'),
    ),
    run(
      db
        .from('audit_log')
        .select('note, created_at, actor:staff!audit_log_actor_id_fkey(name)')
        .eq('order_id', orderId)
        .eq('action', 'returned_for_rework')
        .order('id', { ascending: false })
        .limit(1),
    ),
  ])

  const c = (completions as Record<string, unknown>[])[0]
  const r = (reworks as Record<string, unknown>[])[0]
  return {
    completion: c
      ? {
          work_done: c.work_done as string,
          extra_charges: toNumber(c.extra_charges),
          remarks: (c.remarks as string | null) ?? null,
          completed_at: c.completed_at as string,
          technician_name: nameOf(c.technician),
        }
      : null,
    payments: (payments as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      amount: toNumber(p.amount),
      method: p.method as PaymentMethod,
      note: (p.note as string | null) ?? null,
      recorded_at: p.recorded_at as string,
      recorded_by_name: nameOf(p.recorder),
      receipt: ((Array.isArray(p.receipt) ? p.receipt[0] : p.receipt) as Payment['receipt'] | undefined) ?? null,
    })),
    rework: r ? { note: (r.note as string | null) ?? '', by: nameOf(r.actor), at: r.created_at as string } : null,
  }
}
