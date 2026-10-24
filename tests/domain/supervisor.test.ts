import { describe, expect, it } from 'vitest'
import {
  approveWarningsBlock,
  checkNoteError,
  checkOrderFormFile,
  canChangeOrderForm,
  insightPeriodPhrase,
  insightSentence,
  isBusy,
  isOverQuote,
  isQuiet,
  orderFormOrder,
  orderFormPath,
  ratingDropped,
  reschedulesUp,
  supervisorRunText,
  type InsightFact,
} from '../../src/domain'

// 0009: supervisor limits, insight rules and sentences, the order form file.

describe('Workflow Supervisor rules', () => {
  it('flags a final amount at least 50% and RM 100 above the quote', () => {
    expect(isOverQuote(350, 980)).toBe(true)
    expect(isOverQuote(200, 300)).toBe(true)
    expect(isOverQuote(200, 299.99)).toBe(false)
    expect(isOverQuote(100, 150)).toBe(false)
    expect(isOverQuote(500, 650)).toBe(false)
    expect(isOverQuote(0, 100)).toBe(true)
    expect(isOverQuote(0, 99.99)).toBe(false)
  })

  it('needs a 3-300 character note and holds Approve while warnings are open', () => {
    expect(checkNoteError(' ok ')).toBe('Write a short note (at least 3 characters)')
    expect(checkNoteError('Called the customer')).toBeNull()
    expect(checkNoteError('x'.repeat(301))).toBe('Keep the note to 300 characters')
    expect(approveWarningsBlock(0)).toBeNull()
    expect(approveWarningsBlock(2)).toBe('Check every warning before approving (2 open)')
  })

  it('words the AI check state plainly', () => {
    expect(supervisorRunText('pending')).toBe('AI check running…')
    expect(supervisorRunText('failed')).toBe("AI check didn't run. Press Re-check to try again.")
    expect(supervisorRunText('done')).toBeNull()
    expect(supervisorRunText(null)).toBeNull()
  })
})

describe('Operational Insight rules and sentences', () => {
  const fact = (over: Partial<InsightFact>): InsightFact => ({
    kind: 'busy',
    technicianId: 't-1',
    technicianName: 'Bala',
    technicianActive: true,
    branchId: 'b-sa',
    branchName: 'Shah Alam',
    value: 11,
    previous: null,
    teamAverage: 5,
    days: null,
    ...over,
  })

  it('applies the limits', () => {
    expect(isBusy(11, 5)).toBe(true)
    expect(isBusy(8, 5)).toBe(true)
    expect(isBusy(7, 5)).toBe(false)
    expect(isBusy(4, 2)).toBe(false)
    expect(isQuiet(1, 5)).toBe(true)
    expect(isQuiet(3, 5)).toBe(false)
    expect(isQuiet(0, 6)).toBe(true)
    expect(reschedulesUp(4, 1)).toBe(true)
    expect(reschedulesUp(6, 4)).toBe(false)
    expect(ratingDropped(3.6, 3, 4.6, 3)).toBe(true)
    expect(ratingDropped(3.7, 3, 4.6, 3)).toBe(false)
    expect(ratingDropped(1, 2, 5, 5)).toBe(false)
    expect(ratingDropped(null, 0, 4, 4)).toBe(false)
  })

  it('writes one plain sentence per kind', () => {
    expect(insightSentence(fact({}), 'this week')).toBe('Bala completed 11 jobs this week, well above the team average of 5.0.')
    expect(insightSentence(fact({ kind: 'quiet', value: 1, technicianActive: false }), 'this week')).toBe(
      'Bala (inactive) completed 1 job this week, well below the team average of 5.0.',
    )
    expect(insightSentence(fact({ kind: 'review_backlog', technicianName: null, value: 1, days: 3 }), 'this week')).toBe(
      "1 job in Shah Alam has waited more than 2 days for a Manager's review (oldest 3 days).",
    )
    expect(insightSentence(fact({ kind: 'reschedules_up', value: 9, previous: 3 }), 'in October 2026')).toBe(
      'Shah Alam had 9 reschedules in October 2026, up from 3 the period before.',
    )
    expect(insightSentence(fact({ kind: 'rating_drop', value: 3.2, previous: 4.6 }), 'this month')).toBe(
      "Bala's average rating fell to 3.2 this month, from 4.6 the period before.",
    )
  })

  it('names the current period "this week" and earlier ones by their dates', () => {
    const now = new Date('2026-10-24T02:00:00Z')
    expect(insightPeriodPhrase('week', '2026-10-19', now)).toBe('this week (Mon 19 – Sun 25 Oct 2026)')
    expect(insightPeriodPhrase('week', '2026-10-12', now)).toBe('in Mon 12 – Sun 18 Oct 2026')
    expect(insightPeriodPhrase('month', '2026-10-01', now)).toBe('this month (October 2026)')
  })
})

describe('Order form file', () => {
  const order = '0b7f8a1e-6c2d-4e3f-9a8b-1c2d3e4f5a6b'
  const file = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

  it('accepts a photo or PDF of up to 10 MB', () => {
    expect(checkOrderFormFile('image/jpeg', 1000)).toEqual({ ok: true, kind: 'photo' })
    expect(checkOrderFormFile('application/pdf', 1000)).toEqual({ ok: true, kind: 'pdf' })
    expect(checkOrderFormFile('image/heic', 1000)).toEqual({ ok: false, error: 'Use a photo (JPG, PNG or WebP) or a PDF' })
    expect(checkOrderFormFile('image/png', 10 * 1024 * 1024 + 1)).toEqual({ ok: false, error: 'The file can be at most 10 MB' })
    expect(checkOrderFormFile('image/png', 0)).toEqual({ ok: false, error: 'The file is empty' })
  })

  it('is stored under <order>/form/ and changed by Admins before work starts', () => {
    const path = orderFormPath(order, file, 'image/webp')
    expect(path).toBe(`${order}/form/${file}.webp`)
    expect(orderFormOrder(path)).toBe(order)
    expect(orderFormOrder(`${order}/${file}.jpg`)).toBeNull()
    expect(canChangeOrderForm('assigned', 'admin')).toBe(true)
    expect(canChangeOrderForm('in_progress', 'admin')).toBe(false)
    expect(canChangeOrderForm('new', 'manager')).toBe(false)
  })
})
