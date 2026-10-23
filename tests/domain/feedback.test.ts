import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_COMMENT_TOO_LONG_MESSAGE,
  FEEDBACK_LINK_PLACEHOLDER,
  FEEDBACK_RATING_REQUIRED_MESSAGE,
  FEEDBACK_TOKEN_PATTERN,
  FEEDBACK_WORKING_REQUIRED_MESSAGE,
  canRecordPhoneFeedback,
  customerMessageFullText,
  feedbackLinkIsPlaceholder,
  feedbackSourceLabel,
  isLowFeedback,
  ratingStars,
  validateFeedbackForm,
} from '../../src/domain'

describe('validateFeedbackForm', () => {
  it('accepts stars and Yes / No, trims the comment, and stores an empty one as none', () => {
    expect(validateFeedbackForm({ rating: 4, workingWell: true, comment: '  Tidy \n' })).toEqual({
      ok: true,
      value: { rating: 4, workingWell: true, comment: 'Tidy' },
    })
    expect(validateFeedbackForm({ rating: 1, workingWell: false, comment: '   ' })).toEqual({
      ok: true,
      value: { rating: 1, workingWell: false, comment: null },
    })
  })

  it('shows every missing or wrong answer at once', () => {
    expect(validateFeedbackForm({ rating: null, workingWell: null, comment: 'x'.repeat(1001) })).toEqual({
      ok: false,
      errors: {
        rating: FEEDBACK_RATING_REQUIRED_MESSAGE,
        workingWell: FEEDBACK_WORKING_REQUIRED_MESSAGE,
        comment: FEEDBACK_COMMENT_TOO_LONG_MESSAGE,
      },
    })
    expect(validateFeedbackForm({ rating: 6, workingWell: true, comment: '' }).ok).toBe(false)
    expect(validateFeedbackForm({ rating: 2.5, workingWell: true, comment: '' }).ok).toBe(false)
  })

  it('counts an emoji as one character', () => {
    expect(validateFeedbackForm({ rating: 5, workingWell: true, comment: '😀'.repeat(1000) }).ok).toBe(true)
    expect(validateFeedbackForm({ rating: 5, workingWell: true, comment: '😀'.repeat(1001) }).ok).toBe(false)
  })
})

describe('isLowFeedback', () => {
  it('is 1-2 stars or not working well', () => {
    expect([1, 2, 3, 4, 5].map((r) => isLowFeedback(r, true))).toEqual([true, true, false, false, false])
    expect(isLowFeedback(5, false)).toBe(true)
  })
})

describe('the link line', () => {
  it('adds a blank line and "Leave feedback: <link>" after the message; nothing for a landline', () => {
    expect(customerMessageFullText('Hi', 'http://localhost:5173/f/abc')).toBe('Hi\n\nLeave feedback: http://localhost:5173/f/abc')
    expect(customerMessageFullText('Hi', null)).toBe('Hi')
  })

  it('spots the placeholder address', () => {
    expect(feedbackLinkIsPlaceholder(`${FEEDBACK_LINK_PLACEHOLDER}/f/abc`)).toBe(true)
    expect(feedbackLinkIsPlaceholder('http://localhost:5173/f/abc')).toBe(false)
    expect(feedbackLinkIsPlaceholder(null)).toBe(false)
  })

  it('tokens are 22 URL-safe characters', () => {
    expect(FEEDBACK_TOKEN_PATTERN.test('q3Z8kP1xVb7nR2mT9wLc4A')).toBe(true)
    expect(FEEDBACK_TOKEN_PATTERN.test('q3Z8kP1xVb7nR2mT9wLc4')).toBe(false)
    expect(FEEDBACK_TOKEN_PATTERN.test('q3Z8kP1xVb7nR2mT9wLc4+')).toBe(false)
  })
})

describe('canRecordPhoneFeedback', () => {
  const told = { channel: 'phone', status: 'told_by_phone' } as const
  it('Admins and covering Managers, for a landline customer told by phone, once', () => {
    expect(canRecordPhoneFeedback('admin', false, 'job_done', told, false)).toBe(true)
    expect(canRecordPhoneFeedback('manager', true, 'closed', told, false)).toBe(true)
    expect(canRecordPhoneFeedback('manager', false, 'job_done', told, false)).toBe(false)
    expect(canRecordPhoneFeedback('technician', true, 'job_done', told, false)).toBe(false)
    expect(canRecordPhoneFeedback('finance', false, 'job_done', told, false)).toBe(false)
    expect(canRecordPhoneFeedback('admin', false, 'job_done', told, true)).toBe(false)
    expect(canRecordPhoneFeedback('admin', false, 'in_progress', told, false)).toBe(false)
    expect(canRecordPhoneFeedback('admin', false, 'job_done', { channel: 'phone', status: 'not_sent' }, false)).toBe(false)
    expect(canRecordPhoneFeedback('admin', false, 'job_done', { channel: 'whatsapp', status: 'sent' }, false)).toBe(false)
  })
})

describe('labels', () => {
  it('draws stars and says how the feedback came in', () => {
    expect(ratingStars(2)).toBe('★★☆☆☆')
    expect(feedbackSourceLabel({ source: 'link', recorded_by_name: null, created_at: '2026-10-22T07:15:00Z' })).toBe(
      'Received from the customer at Thu 22 Oct 2026, 3:15 PM',
    )
    expect(
      feedbackSourceLabel({ source: 'phone', recorded_by_name: 'Nurul Huda', created_at: '2026-10-22T07:15:00Z' }),
    ).toBe('Taken by phone by Nurul Huda at Thu 22 Oct 2026, 3:15 PM')
  })
})
