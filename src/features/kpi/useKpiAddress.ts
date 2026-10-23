import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { kpiAddress, parseKpiAddress, type KpiAddress } from '../../domain'

/**
 * The dashboard's choice (view, first day of the period, branch) kept in the
 * address as `?view=week&start=2026-10-19&branch=<id>`, so a reload or a shared
 * link opens the same view. Anything missing or invalid means this week.
 */
export function useKpiAddress(): [KpiAddress, (change: Partial<KpiAddress>) => void] {
  const [params, setParams] = useSearchParams()
  const address = parseKpiAddress(params.toString())
  const { view, start, branch } = address
  const update = useCallback(
    (change: Partial<KpiAddress>) => {
      setParams(new URLSearchParams(kpiAddress({ view, start, branch, ...change })))
    },
    [view, start, branch, setParams],
  )
  return [address, update]
}

/** A stable text for the address: it changes exactly when the numbers must be loaded again. */
export function addressKey(address: KpiAddress): string {
  return kpiAddress(address)
}
