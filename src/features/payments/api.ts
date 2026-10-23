import type { PaymentInput } from '../../domain'
import { client, run } from '../../lib/api'

/**
 * Recording a payment through `record_payment`, shared by the technician's
 * job and Finance (0004). The database checks who may record it and when.
 */
export type RecordPayment = (
  orderId: string,
  input: PaymentInput,
  clientKey: string,
  receipt: { path: string; fileName: string | null } | null,
) => Promise<void>

/**
 * Record a payment, with its receipt when there is one. `clientKey` makes a
 * retry return the first payment instead of recording it twice.
 */
export const recordPayment: RecordPayment = async (orderId, input, clientKey, receipt) => {
  await run(
    client().rpc('record_payment', {
      p_order_id: orderId,
      p_amount: input.amount,
      p_method: input.method,
      p_note: input.note,
      p_client_key: clientKey,
      p_receipt_path: receipt?.path ?? null,
      p_receipt_file_name: receipt?.fileName ?? null,
    }),
  )
}
