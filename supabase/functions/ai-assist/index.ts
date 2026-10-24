// ai-assist (0009): the Workflow Supervisor's AI check, "Read from photo" on
// the New Order form, and the wording of the Dashboard insights. Deployed to
// the hosted Supabase project (see docs/0009-ai-advanced-workflow.md); runs on
// Deno. The logic lives in handler.ts and the step files (tested with
// Vitest); this file wires the real clients.
//
// Deployed with the built-in JWT check off (--no-verify-jwt), like ask:
// * the database calls it at Job Done with the shared secret
//   (AI_TRIGGER_SECRET here, `ai_trigger_secret` in Supabase Vault);
// * the browser calls it with the person's token, checked here.
// Reads for the person (insight_facts, service types) run with their token;
// the secret key is used only for the service_role steps (the check's input
// and result, the AI log, saved insight wordings). The OpenAI key comes from
// the function's secrets (OPENAI_API_KEY) and never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2'
import OpenAI from 'npm:openai@7.32.0'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { sameSecret, supabaseKey } from '../_shared/keys.ts'
import { AiError, type JsonAiClient } from './ai.ts'
import type { ServiceType } from './formReader.ts'
import { ERROR_MESSAGES, handleAiAssist, parseRequest, type Caller, type StaffRole } from './handler.ts'
import type { SavedWording } from './insights.ts'
import type { SupervisorInput } from './supervisor.ts'

const key = (listVar: string, legacyVar: string) => supabaseKey(listVar, legacyVar, (n) => Deno.env.get(n))

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const PUBLIC_KEY = key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
const SECRET_KEY = key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const TRIGGER_SECRET = Deno.env.get('AI_TRIGGER_SECRET') ?? ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-6-luna'
const OPENAI_EFFORT = Deno.env.get('OPENAI_EFFORT') || 'medium'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

function openAiClient(): JsonAiClient | null {
  if (!OPENAI_API_KEY) return null
  const client = new OpenAI({ apiKey: OPENAI_API_KEY, maxRetries: 1 })
  return {
    async respond(request, signal) {
      try {
        const response = await client.responses.create(
          {
            model: OPENAI_MODEL,
            instructions: request.instructions,
            // deno-lint-ignore no-explicit-any
            input: request.input as any,
            text: {
              format: { type: 'json_schema', name: request.format.name, schema: request.format.schema, strict: true },
            },
            // deno-lint-ignore no-explicit-any
            reasoning: { effort: OPENAI_EFFORT as any },
            max_output_tokens: request.maxOutputTokens,
            // Nothing is kept at OpenAI.
            store: false,
          },
          { signal },
        )
        return {
          text: response.output_text ?? '',
          usage: response.usage
            ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
            : null,
        }
      } catch (e) {
        if (signal.aborted) throw e
        const status = (e as { status?: number }).status
        if (status === 401 || status === 403) throw new AiError(`OpenAI refused the key (${status})`, 'not_set_up')
        throw new AiError(`OpenAI: ${status ?? ''} ${(e as Error).message}`, 'unavailable')
      }
    },
  }
}

const malaysiaToday = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: { code: 'bad_request', message: 'Use POST' } }, 405)
  if (!SUPABASE_URL || !PUBLIC_KEY || !SECRET_KEY) {
    console.error('ai-assist: missing Supabase keys')
    return json({ error: { code: 'error', message: ERROR_MESSAGES.error } }, 500)
  }

  const parsed = parseRequest(await req.json().catch(() => null))
  if (typeof parsed === 'string') return json({ error: { code: 'bad_request', message: parsed } }, 400)

  const trusted = sameSecret(req.headers.get('x-ai-trigger') ?? '', TRIGGER_SECRET)
  const authorization = req.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''

  // The caller's client: reads run as the person (RLS and role checks apply).
  const callerDb = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: NO_SESSION,
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })
  let caller: Caller | null = null
  if (token && token !== PUBLIC_KEY) {
    const { data: who } = await callerDb.auth.getUser(token)
    if (who?.user) {
      const me = await callerDb.rpc('current_staff', {})
      const row = Array.isArray(me.data) ? (me.data[0] as Record<string, unknown> | undefined) : undefined
      if (!me.error && row && row.active !== false) {
        caller = { staffId: row.id as string, role: row.role as StaffRole, branchName: row.branch_name as string }
      }
    }
  }
  if (!trusted && !caller) return json({ error: { code: 'signed_out', message: ERROR_MESSAGES.signed_out } }, 401)

  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: NO_SESSION })

  try {
    const reply = await handleAiAssist(parsed, {
      trusted,
      caller,
      ai: openAiClient(),
      log: {
        async record(entry) {
          const { error } = await admin.rpc('ai_log_record', {
            p_staff_id: entry.staffId,
            p_feature: entry.feature,
            p_summary: entry.summary,
            p_order_id: entry.orderId,
            p_outcome: entry.outcome,
            p_duration_ms: entry.durationMs,
            p_input_tokens: entry.inputTokens,
            p_output_tokens: entry.outputTokens,
          })
          // The log never stops the answer.
          if (error) console.error(`ai-assist: log: ${error.message}`)
        },
      },
      supervisorDb: {
        async input(runId, requestedBy) {
          const { data, error } = await admin.rpc('supervisor_ai_input', { p_run_id: runId, p_requested_by: requestedBy })
          if (error) {
            if (/Check not found|already finished/.test(error.message)) return null
            throw new Error(`supervisor_ai_input: ${error.message}`)
          }
          return data as SupervisorInput
        },
        async save(runId, status, issues, errorText) {
          const { error } = await admin.rpc('supervisor_save_ai', {
            p_run_id: runId,
            p_status: status,
            p_issues: issues,
            p_error: errorText,
          })
          if (error) throw new Error(`supervisor_save_ai: ${error.message}`)
        },
      },
      async serviceTypes(): Promise<ServiceType[]> {
        const { data, error } = await callerDb.from('service_types').select('id, name').eq('active', true).order('name')
        if (error) throw new Error(`service_types: ${error.message}`)
        return data ?? []
      },
      async pdfPages(bytes) {
        try {
          const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
          return pdf.getPageCount()
        } catch {
          return null
        }
      },
      async insightFacts(start, end, branchId) {
        const { data, error } = await callerDb.rpc('insight_facts', { p_start: start, p_end: end, p_branch_id: branchId })
        if (error) return { error: error.message }
        return { rows: (data ?? []) as Record<string, unknown>[] }
      },
      async branchName(branchId) {
        const { data } = await callerDb.from('branches').select('name').eq('id', branchId).maybeSingle()
        return (data?.name as string | undefined) ?? null
      },
      async wordingGet(hash): Promise<SavedWording | null> {
        const { data, error } = await admin.rpc('insight_wording_get', { p_hash: hash })
        if (error) throw new Error(`insight_wording_get: ${error.message}`)
        const row = (Array.isArray(data) ? data[0] : data) as { hash?: string | null; sentences?: unknown; tip?: string | null } | null
        if (!row?.hash) return null
        return { sentences: row.sentences as SavedWording['sentences'], tip: row.tip ?? null }
      },
      async wordingPut(hash, wording) {
        const { error } = await admin.rpc('insight_wording_put', {
          p_hash: hash,
          p_sentences: wording.sentences,
          p_tip: wording.tip,
        })
        // A wording that was not saved is simply written again next time.
        if (error) console.error(`ai-assist: insight_wording_put: ${error.message}`)
      },
      today: malaysiaToday(),
      now: () => performance.now(),
    })
    return json(reply.body, reply.status)
  } catch (e) {
    // Raw errors go to the function's log, never to the person.
    console.error(`ai-assist: ${(e as Error).message}`)
    return json({ error: { code: 'error', message: ERROR_MESSAGES.error } }, 500)
  }
})
