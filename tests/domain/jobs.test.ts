import { describe, expect, it } from 'vitest'
import {
  customerGreeting,
  groupOpenJobs,
  jobArea,
  mapsUrl,
  notificationOpensJob,
  openJobGroup,
  telUrl,
} from '../../src/domain'

// Tue 27 Oct 2026, 00:30 in Malaysia (still Mon 26 Oct in UTC).
const NOW = new Date('2026-10-26T16:30:00Z')

describe('openJobGroup (Malaysia days)', () => {
  it('groups by the scheduled Malaysia day, not the UTC day', () => {
    expect(openJobGroup('2026-10-26T15:59:00Z', NOW)).toBe('overdue') // Mon 23:59 MYT
    expect(openJobGroup('2026-10-26T16:00:00Z', NOW)).toBe('today') // Tue 00:00 MYT
    expect(openJobGroup('2026-10-27T15:59:00Z', NOW)).toBe('today') // Tue 23:59 MYT
    expect(openJobGroup('2026-10-27T16:00:00Z', NOW)).toBe('upcoming') // Wed 00:00 MYT
    expect(openJobGroup(null, NOW)).toBe('unscheduled')
  })

  it('keeps a job earlier today under Today, not Overdue', () => {
    expect(openJobGroup('2026-10-26T16:10:00Z', NOW)).toBe('today')
  })
})

describe('groupOpenJobs', () => {
  it('returns non-empty groups in order, keeping the job order within each', () => {
    const jobs = [
      { id: 'a', scheduled_at: '2026-10-25T02:00:00Z' },
      { id: 'b', scheduled_at: '2026-10-27T02:00:00Z' },
      { id: 'c', scheduled_at: '2026-10-29T02:00:00Z' },
      { id: 'd', scheduled_at: '2026-10-27T06:00:00Z' },
      { id: 'e', scheduled_at: null },
    ]
    expect(groupOpenJobs(jobs, NOW).map((g) => [g.group, g.jobs.map((j) => j.id)])).toEqual([
      ['overdue', ['a']],
      ['today', ['b', 'd']],
      ['upcoming', ['c']],
      ['unscheduled', ['e']],
    ])
    expect(groupOpenJobs([{ scheduled_at: null }], NOW).map((g) => g.group)).toEqual(['unscheduled'])
    expect(groupOpenJobs([], NOW)).toEqual([])
  })
})

describe('job card and contact helpers', () => {
  it('shows the last part of the address as the area', () => {
    expect(jobArea('No. 12, Jalan Sejuk, Shah Alam')).toBe('Shah Alam')
    expect(jobArea('Shah Alam')).toBe('Shah Alam')
    expect(jobArea(' ,  ')).toBe('')
  })

  it('builds call and map links', () => {
    expect(telUrl('60123456789')).toBe('tel:+60123456789')
    expect(telUrl('')).toBeNull()
    expect(mapsUrl('No. 12, Jalan Sejuk, Shah Alam')).toBe(
      'https://www.google.com/maps/search/?api=1&query=No.%2012%2C%20Jalan%20Sejuk%2C%20Shah%20Alam',
    )
    expect(mapsUrl('  ')).toBeNull()
  })

  it('opens the job from every notification except a reassignment away', () => {
    expect(notificationOpensJob('rework')).toBe(true)
    expect(notificationOpensJob('cancelled')).toBe(true)
    expect(notificationOpensJob('reassigned_away')).toBe(false)
  })
})

describe('customerGreeting', () => {
  it('introduces the technician and the job', () => {
    expect(customerGreeting('Ahmad', 'Ali', 'ORDER1234')).toBe(
      'Hi Ahmad, this is Ali from Sejuk Sejuk Service about your aircond job ORDER1234.',
    )
    expect(customerGreeting('Ahmad', null, 'ORDER1234')).toBe(
      'Hi Ahmad, this is Sejuk Sejuk Service about your aircond job ORDER1234.',
    )
  })
})
