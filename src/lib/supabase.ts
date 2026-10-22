import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './supabaseConfig'

const config = readSupabaseConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

/** True when valid Supabase environment variables were provided at build/dev time. */
export const isSupabaseConfigured = config !== null

/**
 * The shared Supabase client, or `null` when the environment is not configured.
 * Importing this module never throws; callers must check for `null` (or
 * `isSupabaseConfigured`) before querying.
 */
export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.anonKey)
  : null
