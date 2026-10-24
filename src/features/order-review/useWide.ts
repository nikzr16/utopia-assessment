import { useEffect, useState } from 'react'

const QUERY = '(min-width: 1024px)'

function matches(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

/**
 * True on a desktop-wide screen (≥ 1024 px). The order page uses it to put
 * its main buttons in the side panel there and in the sticky bottom bar on
 * a phone or tablet, so each button exists once (PRD 0011 Q16).
 */
export function useWide(): boolean {
  const [wide, setWide] = useState(matches)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(QUERY)
    const onChange = () => setWide(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return wide
}
