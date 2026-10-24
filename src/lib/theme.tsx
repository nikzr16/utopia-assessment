import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** Light / dark / follow the device (PRD 0011 Q7). */
export type ThemeChoice = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'sejuk.theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The stored choice; `system` when nothing (or nothing readable) is stored. */
export function readThemeChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function deviceTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? deviceTheme() : choice
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

type ThemeContextValue = { choice: ThemeChoice; theme: Theme; setChoice: (choice: ThemeChoice) => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Keeps `<html data-theme>` in step with the person's choice and, for
 * `system`, with the device setting. `index.html` sets the first value
 * before React loads so there is no white flash.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readThemeChoice)
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(choice))

  useEffect(() => {
    const next = resolveTheme(choice)
    setTheme(next)
    applyTheme(next)
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      const t = deviceTheme()
      setTheme(t)
      applyTheme(t)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [choice])

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
      else window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Private mode or blocked storage: the choice still applies until reload.
    }
    setChoiceState(next)
  }, [])

  const value = useMemo(() => ({ choice, theme, setChoice }), [choice, theme, setChoice])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Works without a provider (tests, public pages): falls back to the device setting. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  return value ?? { choice: 'system', theme: resolveTheme('system'), setChoice: () => {} }
}
