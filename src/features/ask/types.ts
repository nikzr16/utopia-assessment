/**
 * The Ask assistant's shapes come from the `ask` Edge Function itself
 * (type-only imports: nothing from the function is bundled into the app), so
 * the browser and the server cannot drift apart.
 */
export type {
  AskErrorCode,
  AskEvent,
  AskResult,
  AskResultKind,
} from '../../../supabase/functions/ask/handler.ts'
export type { AskTable, DashboardLink, TableKind } from '../../../supabase/functions/ask/lookups.ts'
