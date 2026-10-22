import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrderStatus, PaymentStatus } from '../domain'
import { supabase } from './supabase'

/**
 * Shared plumbing for the features' `api.ts` modules: the Supabase client,
 * one error type with a message that can be shown as it is, and the
 * `order_summary` row every portal reads. Writes go only through RPCs; the
 * database resolves the actor from the session.
 */
export class ApiError extends Error {}

/** One row of `order_summary`. */
export interface OrderSummary {
  id: string
  order_no: string
  branch_id: string
  branch_name: string
  customer_name: string
  customer_phone: string
  customer_address: string
  problem_description: string
  service_type_id: string
  service_type_name: string
  quoted_price: number
  assigned_technician_id: string | null
  technician_name: string | null
  admin_notes: string | null
  status: OrderStatus
  scheduled_at: string | null
  created_at: string
  /** Kept as the database's string: `update_order` compares it exactly. */
  updated_at: string
  extra_charges: number
  final_amount: number
  amount_paid: number
  balance: number
  overpaid_amount: number
  payment_status: PaymentStatus
}

export function client(): SupabaseClient {
  if (!supabase) throw new ApiError('The app is not connected to the database.')
  return supabase
}

export const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection and try again.'

/** Database errors → a sentence for staff. Rule errors are already plain language. */
export function toApiError(error: { message?: string; code?: string } | null | undefined): ApiError {
  const message = error?.message?.trim() ?? ''
  if (error?.code === '42501') return new ApiError('You do not have permission to do that.')
  if (!message || /failed to fetch|network|load failed/i.test(message)) {
    return new ApiError(NETWORK_ERROR_MESSAGE)
  }
  return new ApiError(message)
}

/** A failure worth retrying as it is (no signal), as opposed to a rule saying no. */
export function isNetworkError(error: unknown): boolean {
  return (error as Error | null)?.message === NETWORK_ERROR_MESSAGE
}

export async function run<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  let result: { data: T | null; error: unknown }
  try {
    result = await query
  } catch (e) {
    throw toApiError(e as { message?: string })
  }
  if (result.error) throw toApiError(result.error as { message?: string; code?: string })
  return result.data as T
}

export const toNumber = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))

export function toOrderSummary(row: Record<string, unknown>): OrderSummary {
  return {
    ...(row as unknown as OrderSummary),
    quoted_price: toNumber(row.quoted_price),
    extra_charges: toNumber(row.extra_charges),
    final_amount: toNumber(row.final_amount),
    amount_paid: toNumber(row.amount_paid),
    balance: toNumber(row.balance),
    overpaid_amount: toNumber(row.overpaid_amount),
  }
}
