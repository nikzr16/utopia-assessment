import { describe, expect, it } from 'vitest'
import {
  EMPTY_ORDER_FORM,
  canEditOrder,
  orderToFormValues,
  validateOrderForm,
  type OrderFormValues,
} from '../../src/domain'

const filled: OrderFormValues = {
  branchId: 'branch-1',
  customerName: '  Puan Lim ',
  customerPhone: '012-345 6789',
  customerAddress: ' 8 Jalan Kenanga ',
  problemDescription: 'Not cold',
  serviceTypeId: 'type-1',
  quotedPrice: 'RM 180',
  technicianId: '',
  scheduledAt: '2026-10-26T10:00',
  adminNotes: '  ',
}

describe('validateOrderForm (AC3)', () => {
  it('lists every missing required field', () => {
    expect(validateOrderForm(EMPTY_ORDER_FORM)).toEqual({
      ok: false,
      errors: {
        branchId: 'Select a branch',
        customerName: 'Customer name is required',
        customerPhone: 'Customer phone is required',
        customerAddress: 'Customer address is required',
        problemDescription: 'Problem description is required',
        serviceTypeId: 'Select a service type',
        quotedPrice: 'Quoted price is required',
      },
    })
  })

  it('returns clean values for the database', () => {
    expect(validateOrderForm(filled)).toEqual({
      ok: true,
      input: {
        branchId: 'branch-1',
        customerName: 'Puan Lim',
        customerPhone: '60123456789',
        customerAddress: '8 Jalan Kenanga',
        problemDescription: 'Not cold',
        serviceTypeId: 'type-1',
        quotedPrice: 180,
        technicianId: null,
        scheduledAt: '2026-10-26T02:00:00.000Z',
        adminNotes: null,
      },
    })
    const withTech = validateOrderForm({ ...filled, technicianId: 'tech-1', scheduledAt: '' })
    expect(withTech.ok && withTech.input.technicianId).toBe('tech-1')
    expect(withTech.ok && withTech.input.scheduledAt).toBeNull()
  })

  it('reports a bad phone, price and date', () => {
    const result = validateOrderForm({
      ...filled,
      customerPhone: '012 34',
      quotedPrice: '100000.50',
      scheduledAt: '2026-02-30T10:00',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.customerPhone).toMatch(/valid Malaysian phone number/)
    expect(result.errors.quotedPrice).toBe('Quoted price cannot be more than RM 100,000.00')
    expect(result.errors.scheduledAt).toBe('Enter a valid date and time')
  })
})

describe('orderToFormValues', () => {
  it('fills the edit form from an order (price with 2 decimals, Malaysia time)', () => {
    expect(
      orderToFormValues({
        branch_id: 'b',
        customer_name: 'Puan Lim',
        customer_phone: '60123456789',
        customer_address: 'Addr',
        problem_description: 'P',
        service_type_id: 's',
        quoted_price: '180',
        assigned_technician_id: null,
        scheduled_at: '2026-10-26T02:00:00+00:00',
        admin_notes: null,
      }),
    ).toEqual({
      branchId: 'b',
      customerName: 'Puan Lim',
      customerPhone: '+60 12-345 6789',
      customerAddress: 'Addr',
      problemDescription: 'P',
      serviceTypeId: 's',
      quotedPrice: '180.00',
      technicianId: '',
      scheduledAt: '2026-10-26T10:00',
      adminNotes: '',
    })
  })
})

describe('canEditOrder', () => {
  it('allows New, Assigned and Acknowledged only', () => {
    expect(canEditOrder('new')).toBe(true)
    expect(canEditOrder('acknowledged')).toBe(true)
    expect(canEditOrder('in_progress')).toBe(false)
    expect(canEditOrder('cancelled')).toBe(false)
  })
})
