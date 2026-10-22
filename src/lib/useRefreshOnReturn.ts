import { useEffect } from 'react'

/**
 * Calls `refresh` when the person comes back to the app (the tab or phone
 * screen becomes visible again) or the connection comes back. Field phones
 * switch apps and lose signal often; this keeps lists current without a
 * manual reload.
 */
export function useRefreshOnReturn(refresh: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
    }
  }, [refresh])
}
