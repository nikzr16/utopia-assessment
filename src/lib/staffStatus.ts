import { useEffect, useState } from 'react'
import { staffLabel } from '../domain'
import { client } from './api'

/**
 * Who has left (0006): the ids of inactive staff, loaded once and shared, so
 * any staff screen can tag a name "(inactive)" with `staffLabel`. Any active
 * staff member may read the staff list (RLS); failures just mean no tags.
 */
let inactive: Promise<Set<string>> | null = null
const NONE: ReadonlySet<string> = new Set()
/** The last loaded set, for code that renders outside a hook (table cells). */
let known: ReadonlySet<string> = NONE

export function loadInactiveStaff(): Promise<Set<string>> {
  if (!inactive) {
    inactive = (async () => {
      const { data, error } = await client().from('staff').select('id').eq('active', false)
      if (error) throw error
      known = new Set((data ?? []).map((r: { id: string }) => r.id))
      return known as Set<string>
    })().catch(() => {
      inactive = null
      return new Set<string>()
    })
  }
  return inactive
}

/** Load again next time (after someone is deactivated or reactivated). */
export function forgetInactiveStaff(): void {
  inactive = null
}

/** The inactive staff ids; empty until loaded. A component that calls this re-renders once they are. */
export function useInactiveStaff(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE)
  useEffect(() => {
    let current = true
    loadInactiveStaff().then(
      (set) => {
        if (current) setIds(set)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [])
  return ids
}

/**
 * A staff name as staff screens show it: "Bala (inactive)" once the person has
 * left. Never use it for text sent to customers or technicians.
 */
export function staffName(name: string, id: string | null | undefined): string
export function staffName(name: string | null | undefined, id: string | null | undefined): string | null
export function staffName(name: string | null | undefined, id: string | null | undefined): string | null {
  if (name === null || name === undefined) return null
  return staffLabel(name, !(id && known.has(id)))
}
