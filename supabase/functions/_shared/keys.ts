// Shared by the Edge Functions (0008 ask, 0009 ai-assist). Supabase bundles
// files imported from supabase/functions/_shared with each function.

/** A key from the new JSON key lists, else the legacy variable (as in staff-access). */
export function supabaseKey(listVar: string, legacyVar: string, env: (name: string) => string | undefined): string {
  const list = env(listVar)
  if (list) {
    try {
      const parsed = JSON.parse(list) as Record<string, string>
      const first = parsed.default ?? Object.values(parsed)[0]
      if (first) return first
    } catch {
      // fall through to the legacy variable
    }
  }
  return env(legacyVar) ?? ''
}

/** Compare two secrets without leaking where they differ. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
