import { ApiError, NETWORK_ERROR_MESSAGE, client, run } from '../../lib/api'
import { supabaseConfig } from '../../lib/supabase'
import type { AskEvent, AskResult } from './types'

/**
 * The Ask assistant (0008). Questions go to the `ask` Edge Function, which
 * streams one JSON event per line: steps as they happen, then the result or
 * an error. Chats and the Question log are read under row-level security
 * (own chats; the log for Admins only); only the function writes them.
 */

export interface ChatSummary {
  id: string
  title: string
  updated_at: string
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  body: string
  result: AskResult | null
  created_at: string
}

export interface QuestionLogEntry {
  id: number
  created_at: string
  staff_id: string
  staff_name: string
  staff_role: string
  branch_name: string
  staff_active: boolean
  chat_id: string | null
  question: string
  lookups: { lookup: string; status: string; fn?: string; rows?: number }[]
  row_count: number | null
  outcome: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
}

/** Ask a question; `onEvent` gets each step, then the result or an error. */
export async function askQuestion(
  question: string,
  chatId: string | null,
  onEvent: (event: AskEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!supabaseConfig) throw new ApiError('The app is not connected to the database.')
  const { data } = await client().auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    onEvent({ type: 'error', code: 'signed_out', message: 'Your sign-in has expired. Sign in again.' })
    return
  }

  let response: Response
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseConfig.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question, chatId }),
      signal,
    })
  } catch (e) {
    if (signal.aborted) throw e
    throw new ApiError(NETWORK_ERROR_MESSAGE)
  }
  if (response.status === 404) {
    onEvent({ type: 'error', code: 'not_set_up', message: 'The assistant is not set up yet.' })
    return
  }

  let seen = false
  const handle = (text: string) => {
    if (!text.trim()) return
    try {
      onEvent(JSON.parse(text) as AskEvent)
      seen = true
    } catch {
      // not an event line (e.g. a gateway error page)
    }
  }
  if (response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        handle(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    handle(buffer + decoder.decode())
  } else {
    for (const text of (await response.text()).split('\n')) handle(text)
  }
  if (!seen) throw new ApiError("The assistant can't be reached right now. Try again in a minute.")
}

export function fetchChats(): Promise<ChatSummary[]> {
  return run(
    client().from('ask_chats').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(50),
  ) as Promise<ChatSummary[]>
}

export function fetchChatMessages(chatId: string): Promise<ChatMessage[]> {
  return run(
    client().from('ask_messages').select('id, role, body, result, created_at').eq('chat_id', chatId).order('id'),
  ) as Promise<ChatMessage[]>
}

export async function renameChat(chatId: string, title: string): Promise<void> {
  await run(client().rpc('ask_rename_chat', { p_chat_id: chatId, p_title: title }))
}

export async function deleteChat(chatId: string): Promise<void> {
  await run(client().rpc('ask_delete_chat', { p_chat_id: chatId }))
}

/** The Admin Question log (last 7 days, newest first). */
export function fetchQuestionLog(): Promise<QuestionLogEntry[]> {
  return run(
    client().from('ask_log_entries').select('*').order('created_at', { ascending: false }).limit(500),
  ) as Promise<QuestionLogEntry[]>
}
