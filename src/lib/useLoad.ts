import { useCallback, useEffect, useState } from 'react'

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

/**
 * Runs `load` when `key` changes and on `reload()`. A slower earlier request
 * never overwrites a newer one. Keeps showing the previous data while
 * reloading so the page does not flash.
 */
export function useLoad<T>(load: () => Promise<T>, key: string): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let current = true
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    load().then(
      (data) => {
        if (current) setState({ status: 'ready', data })
      },
      (e: unknown) => {
        if (current) setState({ status: 'error', message: (e as Error).message || 'Something went wrong.' })
      },
    )
    return () => {
      current = false
    }
    // `load` is recreated on every render; `key` says when the request changes.
  }, [key, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return [state, reload]
}
