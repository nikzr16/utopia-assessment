// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from '../../src/lib/drafts'

beforeEach(() => window.localStorage.clear())

describe('drafts on the phone (PRD Q16)', () => {
  it('saves, loads and clears one draft', () => {
    expect(loadDraft('completion:o-1')).toBeNull()
    saveDraft('completion:o-1', { workDone: 'Cleaned' })
    expect(loadDraft('completion:o-1')).toEqual({ workDone: 'Cleaned' })
    clearDraft('completion:o-1')
    expect(loadDraft('completion:o-1')).toBeNull()
  })

  it('clears every draft on sign-out and leaves other storage alone', () => {
    saveDraft('completion:o-1', { a: 1 })
    saveDraft('payment:o-2', { b: 2 })
    window.localStorage.setItem('sb-auth-token', 'keep')
    clearAllDrafts()
    expect(loadDraft('completion:o-1')).toBeNull()
    expect(loadDraft('payment:o-2')).toBeNull()
    expect(window.localStorage.getItem('sb-auth-token')).toBe('keep')
  })

  it('ignores a draft that is not valid JSON', () => {
    window.localStorage.setItem('sejuk-draft:x', '{broken')
    expect(loadDraft('x')).toBeNull()
  })
})
