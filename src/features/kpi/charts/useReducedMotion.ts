import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function current(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

/** True when the person asked their system for less motion: charts then skip their animation. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(current)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(QUERY)
    const onChange = () => setReduced(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}
