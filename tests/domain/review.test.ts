import { describe, expect, it } from 'vitest'
import {
  APPROVE_CUSTOMER_NOT_TOLD_MESSAGE,
  approveBlockReason,
  approvedLabel,
  canVerifyPayment,
  closeBlockReason,
  closedLabel,
  coversBranch,
  customerOnBehalfMessage,
  financeViewOf,
  managerViewOf,
  needsAttention,
  verifiedLabel,
} from '../../src/domain'

describe('coversBranch', () => {
  const nurul = { role: 'manager' as const, branchId: 'sa', additionalBranchIds: ['pg'] }
  it('covers the home and additional branches of a Manager only', () => {
    expect(coversBranch(nurul, 'sa')).toBe(true)
    expect(coversBranch(nurul, 'pg')).toBe(true)
    expect(coversBranch(nurul, 'kl')).toBe(false)
    expect(coversBranch({ ...nurul, role: 'admin' }, 'sa')).toBe(false)
  })
})

describe('queues', () => {
  it('puts Manager orders in tabs', () => {
    expect(managerViewOf({ status: 'job_done', return_count: 2, reviewed_at: null })).toBe('to_review')
    expect(managerViewOf({ status: 'in_progress', return_count: 1, reviewed_at: null })).toBe('returned')
    expect(managerViewOf({ status: 'in_progress', return_count: 0, reviewed_at: null })).toBeNull()
    expect(managerViewOf({ status: 'closed', return_count: 0, reviewed_at: '2026-10-22T07:00:00Z' })).toBe('reviewed')
  })

  it('puts Finance orders in tabs', () => {
    expect(financeViewOf({ status: 'job_done', payment_status: 'partial', payment_count: 1 })).toBe('not_reviewed')
    expect(financeViewOf({ status: 'job_done', payment_status: 'unpaid', payment_count: 0 })).toBeNull()
    expect(financeViewOf({ status: 'reviewed', payment_status: 'paid', payment_count: 1 })).toBe('ready')
    expect(financeViewOf({ status: 'reviewed', payment_status: 'partial', payment_count: 1 })).toBe('outstanding')
    expect(financeViewOf({ status: 'closed', payment_status: 'paid', payment_count: 1 })).toBe('closed')
  })

  it('flags a job returned 3 or more times', () => {
    expect(needsAttention(2)).toBe(false)
    expect(needsAttention(3)).toBe(true)
  })
})

describe('approve and close', () => {
  it('blocks Approve until the customer is told', () => {
    expect(approveBlockReason({ status: 'job_done', latest_message_status: 'not_sent' })).toBe(
      APPROVE_CUSTOMER_NOT_TOLD_MESSAGE,
    )
    expect(approveBlockReason({ status: 'job_done', latest_message_status: 'sent' })).toBeNull()
    expect(approveBlockReason({ status: 'job_done', latest_message_status: 'told_by_phone' })).toBeNull()
  })

  it('blocks Close until paid and verified', () => {
    const base = { status: 'reviewed' as const, payment_status: 'paid' as const, balance: 0, unverified_count: 0 }
    expect(closeBlockReason(base)).toBeNull()
    expect(closeBlockReason({ ...base, payment_status: 'partial', balance: 50 })).toBe(
      'Order must be fully paid before closing (outstanding balance RM 50.00)',
    )
    expect(closeBlockReason({ ...base, unverified_count: 2 })).toBe(
      'Verify every receipt before closing (2 not verified yet)',
    )
    expect(closeBlockReason({ ...base, status: 'job_done' })).not.toBeNull()
  })

  it('lets Finance verify non-cash payments of open orders', () => {
    expect(canVerifyPayment('finance', 'card', 'reviewed')).toBe(true)
    expect(canVerifyPayment('finance', 'cash', 'reviewed')).toBe(false)
    expect(canVerifyPayment('finance', 'card', 'closed')).toBe(false)
    expect(canVerifyPayment('manager', 'card', 'reviewed')).toBe(false)
  })
})

describe('labels and the on-behalf message', () => {
  it('formats who and when in Malaysia time', () => {
    expect(approvedLabel({ reviewed_at: '2026-10-22T07:20:00Z', reviewed_by_name: 'Nurul Huda' })).toBe(
      'Approved by Nurul Huda at Thu 22 Oct 2026, 3:20 PM',
    )
    expect(closedLabel({ closed_at: null, closed_by_name: null })).toBeNull()
    expect(verifiedLabel({ verified_at: '2026-10-22T08:05:00Z', verified_by_name: 'Siti Aminah' })).toBe(
      'Verified by Siti Aminah at Thu 22 Oct 2026, 4:05 PM',
    )
  })

  it('writes the Manager’s message on behalf of the technician', () => {
    expect(
      customerOnBehalfMessage({
        customerName: 'Puan Lim',
        orderNo: 'ORDER1042',
        managerName: 'Nurul Huda',
        branchName: 'Shah Alam',
        technicianName: 'Ali',
        completedAt: '2026-10-22T07:15:00Z',
      }),
    ).toBe(
      'Hi Puan Lim, this is Nurul Huda, Manager at Sejuk Sejuk Service Shah Alam, on behalf of Technician Ali. ' +
        'Job ORDER1042 was completed at Thu 22 Oct 2026, 3:15 PM. Please check and leave feedback. Thank you!',
    )
  })
})
