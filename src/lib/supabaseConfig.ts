/** Pure helpers for validating the Supabase environment variables. */

export interface SupabaseConfig {
  url: string
  anonKey: string
}

const PLACEHOLDER_MARKERS = ['your-project-ref', 'your-anon-public-key']

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Returns a usable config, or null when either variable is missing, blank,
 * still holds the `.env.example` placeholder, or the URL is not http(s).
 */
export function readSupabaseConfig(
  url: string | undefined,
  anonKey: string | undefined,
): SupabaseConfig | null {
  const cleanUrl = url?.trim() ?? ''
  const cleanKey = anonKey?.trim() ?? ''
  if (!cleanUrl || !cleanKey) return null
  if (isPlaceholder(cleanUrl) || isPlaceholder(cleanKey)) return null
  if (!isHttpUrl(cleanUrl)) return null
  return { url: cleanUrl, anonKey: cleanKey }
}
