/**
 * Form drafts kept on the device (PRD Q16, plan P9): what a technician typed
 * survives a reload or a dropped signal. Text only; files are already on the
 * server. Cleared on submit and on sign-out, since field phones are shared.
 * Storage can be unavailable (private mode, full): every call fails quietly.
 */
const PREFIX = 'sejuk-draft:'

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function saveDraft(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Not saved; the form still works.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // Nothing to clear.
  }
}

/** Remove every draft (on sign-out). */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    keys.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    // Nothing to clear.
  }
}
