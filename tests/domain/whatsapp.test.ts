import { describe, expect, it } from 'vitest'
import { technicianJobMessage, whatsAppUrl, type TechnicianJob } from '../../src/domain'

const job: TechnicianJob = {
  orderNo: 'ORDER1001',
  serviceType: 'Repair',
  customerName: 'Puan Lim',
  customerPhone: '60123456789',
  address: '8 Jalan Kenanga, Shah Alam',
  problem: 'Water dripping from indoor unit',
  scheduledAt: '2026-10-26T02:00:00Z',
  quotedPrice: 180,
  adminNotes: 'Gate code 1234',
  technicianName: 'Ali',
  orderUrl: 'https://app.example.com/orders/ORDER1001',
}

describe('technicianJobMessage', () => {
  it('carries the full job details (PRD Q8)', () => {
    expect(technicianJobMessage(job)).toBe(
      [
        'Hi Ali, a new job has been assigned to you.',
        '',
        '*ORDER1001* – Repair',
        'Customer: Puan Lim',
        'Phone: +60 12-345 6789',
        'Address: 8 Jalan Kenanga, Shah Alam',
        'Problem: Water dripping from indoor unit',
        'Scheduled: Mon 26 Oct 2026, 10:00 AM',
        'Quoted price: RM 180.00',
        'Notes: Gate code 1234',
        '',
        'Open in the app: https://app.example.com/orders/ORDER1001',
      ].join('\n'),
    )
  })

  it('says when there is no date, and leaves out empty notes and link', () => {
    const text = technicianJobMessage({ ...job, scheduledAt: null, adminNotes: ' ', orderUrl: undefined })
    expect(text).toContain('Scheduled: Not scheduled yet')
    expect(text).not.toContain('Notes:')
    expect(text).not.toContain('Open in the app')
  })

  it('opens differently for a reassignment and an update', () => {
    expect(technicianJobMessage(job, 'reassigned').split('\n')[0]).toBe('Hi Ali, a job has been reassigned to you.')
    expect(technicianJobMessage(job, 'updated').split('\n')[0]).toBe(
      'Hi Ali, job ORDER1001 has been updated. Latest details:',
    )
  })
})

describe('whatsAppUrl', () => {
  it('builds a wa.me link with the text encoded', () => {
    expect(whatsAppUrl('60120000011', 'Hi Ali & team\n*ORDER1001*')).toBe(
      'https://wa.me/60120000011?text=Hi%20Ali%20%26%20team%0A*ORDER1001*',
    )
    expect(whatsAppUrl('+60 12-000 0011', 'x')).toBe('https://wa.me/60120000011?text=x')
  })

  it('returns null without a phone number', () => {
    expect(whatsAppUrl('', 'x')).toBeNull()
  })
})
