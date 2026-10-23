// ask (0008): the AI operations query. Deployed to the hosted Supabase project
// (see docs/0008-ai-ops-query-workflow.md); runs on Deno. The logic lives in
// handler.ts and lookups.ts (tested with Vitest); this file wires the real
// clients and streams the answer.
//
// Deployed with the built-in JWT check off (--no-verify-jwt) because the
// project uses the new API keys; the caller's token is checked here instead.
// Every lookup runs with the caller's token (RLS and the read functions'
// rules apply). The secret key is used only to save the chat and the
// Question log (ask_record, service_role only). The OpenAI key comes from the
// function's secrets (OPENAI_API_KEY) and never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2'
import OpenAI from 'npm:openai@7.32.0'
import {
  AiError,
  ERROR_MESSAGES,
  TURNS_SENT,
  handleAsk,
  parseAskRequest,
  type AiClient,
  type AskEvent,
  type Turn,
} from './handler.ts'

/** A key from the new JSON key lists, else the legacy variable (as in staff-access). */
function key(listVar: string, legacyVar: string): string {
  const list = Deno.env.get(listVar)
  if (list) {
    try {
      const parsed = JSON.parse(list) as Record<string, string>
      const first = parsed.default ?? Object.values(parsed)[0]
      if (first) return first
    } catch {
      // fall through to the legacy variable
    }
  }
  return Deno.env.get(legacyVar) ?? ''
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const PUBLIC_KEY = key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
const SECRET_KEY = key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-6-luna'
// Thinking level (P7: medium); `low` is the fallback if answers are too slow.
const OPENAI_EFFORT = Deno.env.get('OPENAI_EFFORT') || 'medium'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

const line = (event: AskEvent) => `${JSON.stringify(event)}\n`
const single = (event: AskEvent, status = 200) =>
  new Response(line(event), { status, headers: { ...CORS, 'Content-Type': 'application/x-ndjson' } })

function openAiClient(): AiClient | null {
  if (!OPENAI_API_KEY) return null
  // One retry at most, so a retry cannot break the 20-second limit.
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
            // deno-lint-ignore no-explicit-any
            tools: request.tools as any,
            tool_choice: request.toolChoice,
            parallel_tool_calls: true,
            // deno-lint-ignore no-explicit-any
            reasoning: { effort: OPENAI_EFFORT as any },
            max_output_tokens: 4000,
            // Nothing is kept at OpenAI; reasoning is passed back encrypted.
            store: false,
            include: ['reasoning.encrypted_content'],
          },
          { signal },
        )
        return {
          // deno-lint-ignore no-explicit-any
          output: response.output as any,
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return single({ type: 'error', code: 'bad_request', message: 'Use POST' }, 405)
  if (!SUPABASE_URL || !PUBLIC_KEY || !SECRET_KEY) {
    console.error('ask: missing Supabase keys')
    return single({ type: 'error', code: 'error', message: ERROR_MESSAGES.error }, 500)
  }

  const authorization = req.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return single({ type: 'error', code: 'signed_out', message: ERROR_MESSAGES.signed_out }, 401)

  const caller = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: NO_SESSION,
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: who, error: whoError } = await caller.auth.getUser(token)
  if (whoError || !who.user) {
    return single({ type: 'error', code: 'signed_out', message: ERROR_MESSAGES.signed_out }, 401)
  }

  const parsed = parseAskRequest(await req.json().catch(() => null))
  if (typeof parsed === 'string') return single({ type: 'error', code: 'bad_request', message: parsed }, 400)

  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: NO_SESSION })
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AskEvent) => controller.enqueue(encoder.encode(line(event)))
      try {
        await handleAsk(parsed, {
          db: caller,
          ai: openAiClient(),
          async branches() {
            const { data, error } = await caller.from('branches').select('id, name').order('name')
            if (error) throw new Error(`branches: ${error.message}`)
            return data ?? []
          },
          async turns(chatId): Promise<Turn[] | null> {
            const chat = await caller.from('ask_chats').select('id').eq('id', chatId).maybeSingle()
            if (chat.error || !chat.data) return null
            const { data, error } = await caller
              .from('ask_messages')
              .select('role, body, result')
              .eq('chat_id', chatId)
              .order('id', { ascending: false })
              .limit(TURNS_SENT * 2)
            if (error) throw new Error(`turns: ${error.message}`)
            return (data ?? []).reverse().map((m) => ({
              role: m.role as 'user' | 'assistant',
              body: m.body as string,
              found: Array.isArray(m.result?.found) ? (m.result.found as string[]) : [],
            }))
          },
          async record(entry) {
            const { data, error } = await admin.rpc('ask_record', {
              p_staff_id: entry.staffId,
              p_chat_id: entry.chatId,
              p_question: entry.question,
              p_answer: entry.answer,
              p_result: entry.result,
              p_save: entry.save,
              p_lookups: entry.lookups,
              p_row_count: entry.rowCount,
              p_outcome: entry.outcome,
              p_duration_ms: entry.durationMs,
              p_input_tokens: entry.inputTokens,
              p_output_tokens: entry.outputTokens,
            })
            if (error) throw new Error(error.message)
            const row = Array.isArray(data) ? data[0] : data
            return { chatId: row?.chat_id ?? null, messageId: row?.message_id ?? null }
          },
          emit,
          log: (m) => console.error(`ask: ${m}`),
          now: () => new Date(),
        })
      } catch (e) {
        // Raw errors go to the function's log, never to the answer.
        console.error(`ask: ${(e as Error).message}`)
        emit({ type: 'error', code: 'error', message: ERROR_MESSAGES.error })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(body, {
    headers: { ...CORS, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  })
})
