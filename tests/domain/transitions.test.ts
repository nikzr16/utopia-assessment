import { describe, expect, it } from 'vitest'
import {
  ORDER_STATUSES,
  STAFF_ROLES,
  TRANSITION_RULES,
  availableTransitions,
  canTransition,
  findTransition,
  isTerminal,
  statusLabel,
} from '../../src/domain'

describe('status labels', () => {
  it('labels job_done as "Job Done – awaiting review"', () => {
    expect(statusLabel('job_done')).toBe('Job Done – awaiting review')
  })

  it('labels every status', () => {
    for (const s of ORDER_STATUSES) expect(statusLabel(s).length).toBeGreaterThan(0)
  })

  it('marks only closed and cancelled as terminal', () => {
    expect(ORDER_STATUSES.filter(isTerminal)).toEqual(['closed', 'cancelled'])
  })
})

describe('AC3/AC4 transition mirror', () => {
  it('has 13 rules with no duplicates', () => {
    expect(TRANSITION_RULES).toHaveLength(13)
    const keys = TRANSITION_RULES.map((r) => `${r.from}>${r.to}>${r.role}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('allows the PRD paths for the listed roles', () => {
    expect(canTransition('new', 'assigned', 'admin')).toBe(true)
    expect(canTransition('assigned', 'acknowledged', 'technician')).toBe(true)
    expect(canTransition('assigned', 'in_progress', 'technician')).toBe(true)
    expect(canTransition('job_done', 'reviewed', 'manager')).toBe(true)
    expect(canTransition('reviewed', 'closed', 'finance')).toBe(true)
  })

  it('rejects wrong roles and illegal moves', () => {
    expect(canTransition('reviewed', 'closed', 'admin')).toBe(false)
    expect(canTransition('in_progress', 'assigned', 'admin')).toBe(false)
    expect(canTransition('in_progress', 'cancelled', 'admin')).toBe(false)
    expect(canTransition('new', 'closed', 'finance')).toBe(false)
  })

  it('has no transitions out of terminal statuses', () => {
    for (const r of TRANSITION_RULES) expect(isTerminal(r.from)).toBe(false)
  })

  it('flags note and paid requirements', () => {
    expect(findTransition('job_done', 'in_progress', 'manager')?.noteRequired).toBe(true)
    expect(findTransition('new', 'cancelled', 'admin')?.noteRequired).toBe(true)
    expect(findTransition('reviewed', 'closed', 'finance')?.paidRequired).toBe(true)
    expect(findTransition('assigned', 'acknowledged', 'technician')?.assignedTechnicianOnly).toBe(
      true,
    )
  })

  it('lists available actions per role and status', () => {
    expect(availableTransitions('assigned', 'technician').map((r) => r.to).sort()).toEqual([
      'acknowledged',
      'in_progress',
    ])
    expect(availableTransitions('closed', 'finance')).toEqual([])
    for (const role of STAFF_ROLES) expect(availableTransitions('closed', role)).toEqual([])
  })
})
