import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_MESSAGE_AUDIT_ACTIONS,
  CUSTOMER_MESSAGE_MAX_LENGTH,
  CUSTOMER_MESSAGE_REQUIRED_MESSAGE,
  CUSTOMER_MESSAGE_STATUSES,
  CUSTOMER_MESSAGE_TOO_LONG_MESSAGE,
  ORDER_STATUSES,
  STAFF_ROLES,
  canCallCustomer,
  canEditCustomerMessage,
  canManageCustomerMessage,
  canSendCustomerMessage,
  checkCustomerMessageBody,
  customerMessageEdited,
  customerMessageEditedLabel,
  customerMessageOffered,
  customerMessageStateLabel,
  customerNotTold,
  whatsAppUrl,
  type CustomerMessage,
} from '../../src/domain'

const message = (overrides: Partial<CustomerMessage> = {}): CustomerMessage => ({
  id: '5b0e0c64-6a39-4bd0-9d7e-3f2f8f3c9a10',
  order_id: '0b6f3c1e-8a2d-4c5e-9f10-1a2b3c4d5e6f',
  channel: 'whatsapp',
  phone: '60123456789',
  prepared_body: 'Hi Encik Hafiz, Job ORDER1001 has been completed by Technician Ali at Thu 22 Oct 2026, 3:15 PM.',
  body: 'Hi Encik Hafiz, Job ORDER1001 has been completed by Technician Ali at Thu 22 Oct 2026, 3:15 PM.',
  status: 'not_sent',
  edited_by: null,
  edited_by_name: null,
  edited_at: null,
  confirmed_by: null,
  confirmed_by_name: null,
  confirmed_at: null,
  created_at: '2026-10-22T07:15:00Z',
  ...overrides,
})

describe('checkCustomerMessageBody', () => {
  it('trims the text and keeps line breaks inside it', () => {
    expect(checkCustomerMessageBody('  Hi there!  ')).toEqual({ ok: true, value: 'Hi there!' })
    expect(checkCustomerMessageBody('\nLine one\n\nLine two\n')).toEqual({ ok: true, value: 'Line one\n\nLine two' })
  })

  it('needs some text', () => {
    for (const input of ['', '   ', '\n\t ']) {
      expect(checkCustomerMessageBody(input)).toEqual({ ok: false, error: CUSTOMER_MESSAGE_REQUIRED_MESSAGE })
    }
  })

  it('allows 1,000 characters after trimming and no more; an emoji counts as one', () => {
    expect(CUSTOMER_MESSAGE_MAX_LENGTH).toBe(1000)
    expect(checkCustomerMessageBody(` ${'a'.repeat(1000)} `).ok).toBe(true)
    expect(checkCustomerMessageBody('a'.repeat(1001))).toEqual({ ok: false, error: CUSTOMER_MESSAGE_TOO_LONG_MESSAGE })
    expect(checkCustomerMessageBody('😀'.repeat(1000)).ok).toBe(true)
    expect(checkCustomerMessageBody('😀'.repeat(1001)).ok).toBe(false)
  })
})

describe('where the customer message is offered', () => {
  it('is while the order is Job Done, Reviewed or Closed', () => {
    expect(CUSTOMER_MESSAGE_STATUSES).toEqual(['job_done', 'reviewed', 'closed'])
    expect(ORDER_STATUSES.filter(customerMessageOffered)).toEqual(['job_done', 'reviewed', 'closed'])
  })

  it('lets the assigned technician and Admins act, nobody else', () => {
    for (const status of ORDER_STATUSES) {
      const offered = customerMessageOffered(status)
      expect(canManageCustomerMessage(status, 'admin', false)).toBe(offered)
      expect(canManageCustomerMessage(status, 'technician', true)).toBe(offered)
      expect(canManageCustomerMessage(status, 'technician', false)).toBe(false)
      expect(canManageCustomerMessage(status, 'manager', false)).toBe(false)
      expect(canManageCustomerMessage(status, 'finance', false)).toBe(false)
    }
    // Being "assigned" does not make a Manager or Finance user an actor.
    for (const role of STAFF_ROLES.filter((r) => r !== 'admin' && r !== 'technician')) {
      expect(canManageCustomerMessage('job_done', role, true)).toBe(false)
    }
  })
})

describe('customerNotTold', () => {
  it('is true while the latest message is not sent', () => {
    expect(customerNotTold(message())).toBe(true)
    expect(customerNotTold(message({ status: 'sent' }))).toBe(false)
    expect(customerNotTold(message({ channel: 'phone', phone: '60312345678', status: 'told_by_phone' }))).toBe(false)
  })

  it('is false when there is no message', () => {
    expect(customerNotTold(null)).toBe(false)
    expect(customerNotTold(undefined)).toBe(false)
  })

  it('is false while the order is back with the technician for rework', () => {
    expect(customerNotTold(message(), 'job_done')).toBe(true)
    expect(customerNotTold(message(), 'reviewed')).toBe(true)
    expect(customerNotTold(message(), 'closed')).toBe(true)
    expect(customerNotTold(message(), 'in_progress')).toBe(false)
    expect(customerNotTold(message({ status: 'sent' }), 'job_done')).toBe(false)
  })
})

describe('which button the message offers', () => {
  it('offers Send and Edit for an unsent WhatsApp message', () => {
    expect(canSendCustomerMessage(message())).toBe(true)
    expect(canEditCustomerMessage(message())).toBe(true)
    expect(canCallCustomer(message())).toBe(false)
  })

  it('offers Call for an unsent landline message, with no Send or Edit', () => {
    const landline = message({ channel: 'phone', phone: '60312345678' })
    expect(canCallCustomer(landline)).toBe(true)
    expect(canSendCustomerMessage(landline)).toBe(false)
    expect(canEditCustomerMessage(landline)).toBe(false)
  })

  it('offers nothing once the message is sent or the customer was told', () => {
    for (const m of [
      message({ status: 'sent' }),
      message({ channel: 'phone', phone: '60312345678', status: 'told_by_phone' }),
    ]) {
      expect(canSendCustomerMessage(m)).toBe(false)
      expect(canEditCustomerMessage(m)).toBe(false)
      expect(canCallCustomer(m)).toBe(false)
    }
  })

  it('builds the wa.me link from the stored number and the text that will be sent', () => {
    const m = message({ body: 'Hi Encik Hafiz & family, your job is done!' })
    expect(whatsAppUrl(m.phone, m.body)).toBe(
      'https://wa.me/60123456789?text=Hi%20Encik%20Hafiz%20%26%20family%2C%20your%20job%20is%20done!',
    )
  })
})

describe('state labels', () => {
  it('has none while the message is not sent', () => {
    expect(customerMessageStateLabel(message())).toBeNull()
  })

  it('reads "Sent by X at T" in Malaysia time', () => {
    expect(
      customerMessageStateLabel(
        message({ status: 'sent', confirmed_by_name: 'Ali', confirmed_at: '2026-10-22T07:20:00Z' }),
      ),
    ).toBe('Sent by Ali at Thu 22 Oct 2026, 3:20 PM')
  })

  it('reads "Told by phone by X at T" for a landline customer', () => {
    expect(
      customerMessageStateLabel(
        message({
          channel: 'phone',
          status: 'told_by_phone',
          confirmed_by_name: 'Aisyah Rahman',
          confirmed_at: '2026-10-22T20:30:00Z',
        }),
      ),
    ).toBe('Told by phone by Aisyah Rahman at Fri 23 Oct 2026, 4:30 AM')
  })

  it('still reads sensibly when the confirmer or time is missing', () => {
    expect(customerMessageStateLabel(message({ status: 'sent', confirmed_by_name: null, confirmed_at: null }))).toBe(
      'Sent by someone',
    )
  })

  it('reads "Edited by X at T" only when the text was edited', () => {
    expect(customerMessageEdited(message())).toBe(false)
    expect(customerMessageEditedLabel(message())).toBeNull()
    const edited = message({ edited_by_name: 'Ali', edited_at: '2026-10-22T07:18:00Z' })
    expect(customerMessageEdited(edited)).toBe(true)
    expect(customerMessageEditedLabel(edited)).toBe('Edited by Ali at Thu 22 Oct 2026, 3:18 PM')
  })
})

describe('audit actions', () => {
  it('names the three entries the database writes', () => {
    expect([...CUSTOMER_MESSAGE_AUDIT_ACTIONS]).toEqual(['customer_message_edited', 'customer_messaged', 'customer_called'])
  })
})
