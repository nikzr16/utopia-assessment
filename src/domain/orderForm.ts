import { fromMalaysiaDateTimeInput, toMalaysiaDateTimeInput } from './malaysiaTime'
import { formatMyPhone, normalizeMyPhone } from './phone'
import { parseQuotedPrice } from './price'

/**
 * The Admin's order form: raw field values, validation, and the clean values
 * sent to `create_order` / `update_order`. Messages match the database's
 * wherever the database has the same rule.
 */
export interface OrderFormValues {
  branchId: string
  customerName: string
  customerPhone: string
  customerAddress: string
  problemDescription: string
  serviceTypeId: string
  quotedPrice: string
  /** '' = no technician (New order). Ignored when editing. */
  technicianId: string
  /** `datetime-local` value in Malaysia time; '' = not scheduled. */
  scheduledAt: string
  adminNotes: string
}

export type OrderFormField = keyof OrderFormValues
export type OrderFormErrors = Partial<Record<OrderFormField, string>>

export interface OrderInput {
  branchId: string
  customerName: string
  /** Stored form, `60123456789`. */
  customerPhone: string
  customerAddress: string
  problemDescription: string
  serviceTypeId: string
  quotedPrice: number
  technicianId: string | null
  /** ISO instant or null. */
  scheduledAt: string | null
  adminNotes: string | null
}

export type OrderFormResult = { ok: true; input: OrderInput } | { ok: false; errors: OrderFormErrors }

export const EMPTY_ORDER_FORM: OrderFormValues = {
  branchId: '',
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  problemDescription: '',
  serviceTypeId: '',
  quotedPrice: '',
  technicianId: '',
  scheduledAt: '',
  adminNotes: '',
}

/** Field order, used to focus the first field with an error. */
export const ORDER_FORM_FIELDS: readonly OrderFormField[] = [
  'branchId',
  'customerName',
  'customerPhone',
  'customerAddress',
  'problemDescription',
  'serviceTypeId',
  'quotedPrice',
  'technicianId',
  'scheduledAt',
  'adminNotes',
]

export function validateOrderForm(values: OrderFormValues): OrderFormResult {
  const errors: OrderFormErrors = {}

  if (!values.branchId) errors.branchId = 'Select a branch'
  const customerName = values.customerName.trim()
  if (!customerName) errors.customerName = 'Customer name is required'

  let customerPhone = ''
  if (!values.customerPhone.trim()) {
    errors.customerPhone = 'Customer phone is required'
  } else {
    const phone = normalizeMyPhone(values.customerPhone)
    if (phone.ok) customerPhone = phone.value
    else errors.customerPhone = phone.error
  }

  const customerAddress = values.customerAddress.trim()
  if (!customerAddress) errors.customerAddress = 'Customer address is required'
  const problemDescription = values.problemDescription.trim()
  if (!problemDescription) errors.problemDescription = 'Problem description is required'
  if (!values.serviceTypeId) errors.serviceTypeId = 'Select a service type'

  let quotedPrice = 0
  const price = parseQuotedPrice(values.quotedPrice)
  if (price.ok) quotedPrice = price.value
  else errors.quotedPrice = price.error

  const scheduledAt = fromMalaysiaDateTimeInput(values.scheduledAt)
  if (scheduledAt === undefined) errors.scheduledAt = 'Enter a valid date and time'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const adminNotes = values.adminNotes.trim()
  return {
    ok: true,
    input: {
      branchId: values.branchId,
      customerName,
      customerPhone,
      customerAddress,
      problemDescription,
      serviceTypeId: values.serviceTypeId,
      quotedPrice,
      technicianId: values.technicianId || null,
      scheduledAt: scheduledAt ?? null,
      adminNotes: adminNotes || null,
    },
  }
}

/** Form values for editing an existing order. */
export function orderToFormValues(order: {
  branch_id: string
  customer_name: string
  customer_phone: string
  customer_address: string
  problem_description: string
  service_type_id: string
  quoted_price: number | string
  assigned_technician_id: string | null
  scheduled_at: string | null
  admin_notes: string | null
}): OrderFormValues {
  return {
    branchId: order.branch_id,
    customerName: order.customer_name,
    customerPhone: formatMyPhone(order.customer_phone),
    customerAddress: order.customer_address,
    problemDescription: order.problem_description,
    serviceTypeId: order.service_type_id,
    quotedPrice: Number(order.quoted_price).toFixed(2),
    technicianId: order.assigned_technician_id ?? '',
    scheduledAt: toMalaysiaDateTimeInput(order.scheduled_at),
    adminNotes: order.admin_notes ?? '',
  }
}
