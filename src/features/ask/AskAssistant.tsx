import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { formatMalaysiaDateTime, type StaffRole } from '../../domain'
import { Dialog } from '../../components/Dialog'
import { BUTTON, INPUT, LINK } from '../../components/styles'
import { AnswerCard } from './AnswerCard'
import { askQuestion, deleteChat, fetchChatMessages, fetchChats, renameChat, type ChatSummary } from './api'
import { EXAMPLE_QUESTIONS } from './examples'
import type { AskErrorCode, AskResult } from './types'

/**
 * The Ask assistant (0008): a floating chat bubble on every portal page
 * (PRD Q18). It opens a panel with the person's saved chats (kept 7 days),
 * the conversation, and example questions for a new chat. While a question
 * runs, the steps the server reports are shown as they happen (P5); the
 * browser gives up after 20 seconds.
 */

export const ASK_TIME_LIMIT_MS = 20_000
const MAX_QUESTION_LENGTH = 1000

interface Message {
  key: string
  role: 'user' | 'assistant'
  body: string
  result: AskResult | null
}

interface Failure {
  code: AskErrorCode | 'network'
  message: string
  question: string
}

const ICON_BASE =
  'min-h-9 items-center rounded-md px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-300'
const ICON_BUTTON = `inline-flex ${ICON_BASE}`

let keyCounter = 0
const nextKey = () => `m${++keyCounter}`

export function AskAssistant({ role, orderPath }: { role: StaffRole; orderPath: (orderNo: string) => string }) {
  const [open, setOpen] = useState(false)
  return open ? (
    <AskPanel role={role} orderPath={orderPath} onClose={() => setOpen(false)} />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Ask the assistant"
      className="fixed bottom-24 right-4 z-40 inline-flex h-14 items-center gap-2 rounded-full bg-sky-700 px-5 text-sm font-semibold text-white shadow-lg hover:bg-sky-800 focus:outline-none focus:ring-4 focus:ring-sky-300 sm:bottom-6 sm:right-6"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m-9 6 3-3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v13Z" />
      </svg>
      Ask
    </button>
  )
}

function AskPanel({
  role,
  orderPath,
  onClose,
}: {
  role: StaffRole
  orderPath: (orderNo: string) => string
  onClose: () => void
}) {
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [step, setStep] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [showChats, setShowChats] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const [loadingChat, setLoadingChat] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const running = useRef<AbortController | null>(null)
  const busy = step !== null

  useEffect(() => {
    input.current?.focus()
    return () => running.current?.abort()
  }, [])

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, step, failure])

  const loadChats = async () => {
    setChatsError(null)
    try {
      setChats(await fetchChats())
    } catch (e) {
      setChatsError((e as Error).message)
    }
  }

  useEffect(() => {
    if (showChats || expanded) void loadChats()
  }, [showChats, expanded])

  const newChat = () => {
    running.current?.abort()
    setChatId(null)
    setMessages([])
    setFailure(null)
    setStep(null)
    setShowChats(false)
    input.current?.focus()
  }

  const openChat = async (id: string) => {
    running.current?.abort()
    setShowChats(false)
    setFailure(null)
    setLoadingChat(true)
    try {
      const rows = await fetchChatMessages(id)
      setChatId(id)
      setMessages(rows.map((r) => ({ key: nextKey(), role: r.role, body: r.body, result: r.result })))
    } catch (e) {
      setFailure({ code: 'network', message: (e as Error).message, question: '' })
    } finally {
      setLoadingChat(false)
    }
  }

  const ask = async (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    if (question.length > MAX_QUESTION_LENGTH) {
      setFailure({ code: 'bad_request', message: `Keep the question to ${MAX_QUESTION_LENGTH} characters`, question })
      return
    }
    const userKey = nextKey()
    setMessages((m) => [...m, { key: userKey, role: 'user', body: question, result: null }])
    setDraft('')
    setFailure(null)
    setStep('Sending your question…')

    const controller = new AbortController()
    running.current = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, ASK_TIME_LIMIT_MS)
    let failed: Failure | null = null
    let answered = false
    try {
      await askQuestion(
        question,
        chatId,
        (event) => {
          if (controller.signal.aborted) return
          if (event.type === 'step') setStep(event.text)
          else if (event.type === 'result') {
            answered = true
            if (event.chatId) setChatId(event.chatId)
            setMessages((m) => [...m, { key: nextKey(), role: 'assistant', body: event.result.answer, result: event.result }])
          } else failed = { code: event.code, message: event.message, question }
        },
        controller.signal,
      )
      if (!answered && !failed && !controller.signal.aborted) {
        failed = { code: 'error', message: 'Something went wrong while answering. Try again.', question }
      }
    } catch (e) {
      if (timedOut) failed = { code: 'timeout', message: 'This is taking too long. Try again.', question }
      else if (!controller.signal.aborted) failed = { code: 'network', message: (e as Error).message, question }
    } finally {
      clearTimeout(timer)
      if (running.current === controller) running.current = null
    }
    if (controller.signal.aborted && !timedOut) return
    setStep(null)
    if (failed) {
      const f = failed as Failure
      // The question goes back in the box (PRD Q16); the chat keeps only answered turns.
      setMessages((m) => m.filter((x) => x.key !== userKey))
      setDraft(f.question)
      setFailure(f)
      if (f.code === 'chat_not_found') setChatId(null)
    } else if (showChats || expanded) {
      void loadChats()
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void ask(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void ask(draft)
    }
  }

  const listColumn = expanded || showChats
  return (
    <section
      role="dialog"
      aria-label="Ask the assistant"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      className={`fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100vh-3rem))] sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-2xl ${
        expanded ? 'sm:w-[min(820px,calc(100vw-3rem))]' : 'sm:w-[420px]'
      }`}
    >
      <header className="flex items-center gap-1 border-b border-slate-200 px-3 py-2">
        <h2 className="mr-auto text-base font-semibold text-slate-900">Ask</h2>
        <button type="button" className={ICON_BUTTON} onClick={() => setShowChats((s) => !s)} aria-pressed={showChats}>
          Chats
        </button>
        <button type="button" className={ICON_BUTTON} onClick={newChat}>
          New chat
        </button>
        <button
          type="button"
          className={`${ICON_BASE} hidden sm:inline-flex`}
          onClick={() => setExpanded((x) => !x)}
          aria-pressed={expanded}
        >
          {expanded ? 'Narrow' : 'Wider'}
        </button>
        <button type="button" className={ICON_BUTTON} onClick={onClose} aria-label="Close the assistant">
          ✕
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {listColumn && (
          <ChatList
            className={expanded && !showChats ? 'hidden w-60 border-r sm:block' : expanded ? 'w-60 border-r' : 'w-full'}
            chats={chats}
            error={chatsError}
            currentId={chatId}
            onOpen={(id) => void openChat(id)}
            onReload={() => void loadChats()}
            onRenamed={() => void loadChats()}
            onDeleted={(id) => {
              if (id === chatId) newChat()
              void loadChats()
            }}
          />
        )}
        <div className={`min-w-0 flex-1 flex-col ${showChats && !expanded ? 'hidden' : 'flex'}`}>
          <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3" aria-live="polite">
            {loadingChat && <p className="text-sm text-slate-600">Opening the chat…</p>}
            {!loadingChat && messages.length === 0 && (
              <div>
                <p className="text-sm text-slate-700">
                  Ask about jobs, technicians, payments, reschedules, ratings and returns. In English or Malay.
                </p>
                <div className="mt-3 flex flex-col items-start gap-2" role="group" aria-label="Example questions">
                  {EXAMPLE_QUESTIONS[role].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void ask(q)}
                      disabled={busy}
                      className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-left text-sm text-sky-900 hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-500">Chats are kept for 7 days.</p>
              </div>
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.key} className="ml-auto max-w-[85%] rounded-lg bg-sky-700 px-3 py-2 text-sm text-white">
                  {m.body}
                </div>
              ) : (
                <div key={m.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  {m.result ? (
                    <AnswerCard result={m.result} role={role} orderPath={orderPath} onAsk={(q) => void ask(q)} busy={busy} />
                  ) : (
                    <p className="text-sm">{m.body}</p>
                  )}
                </div>
              ),
            )}
            {step && (
              <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
                <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
                {step}
              </p>
            )}
            {failure && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p>{failure.message}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {failure.question && failure.code !== 'bad_request' && failure.code !== 'not_set_up' && (
                    <button type="button" className={LINK} onClick={() => void ask(failure.question)}>
                      Try again
                    </button>
                  )}
                  {(failure.code === 'ai_unavailable' || failure.code === 'timeout') && role !== 'technician' && (
                    <Link className={LINK} to="/dashboard">
                      Open the Dashboard
                    </Link>
                  )}
                  {(failure.code === 'ai_unavailable' || failure.code === 'timeout') && role === 'technician' && (
                    <Link className={LINK} to="/my-week">
                      Open My week
                    </Link>
                  )}
                </div>
              </div>
            )}
            <div ref={end} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-slate-200 p-3">
            <label htmlFor="ask-question" className="sr-only">
              Your question
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="ask-question"
                ref={input}
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                maxLength={MAX_QUESTION_LENGTH}
                placeholder="e.g. What jobs did Ali complete last week?"
                className={`${INPUT} resize-none`}
              />
              <button type="submit" className={BUTTON.primary} disabled={busy || !draft.trim()}>
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

function ChatList({
  className,
  chats,
  error,
  currentId,
  onOpen,
  onReload,
  onRenamed,
  onDeleted,
}: {
  className: string
  chats: ChatSummary[] | null
  error: string | null
  currentId: string | null
  onOpen: (id: string) => void
  onReload: () => void
  onRenamed: () => void
  onDeleted: (id: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [deleting, setDeleting] = useState<ChatSummary | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const saveTitle = async (e: FormEvent) => {
    e.preventDefault()
    if (!renaming) return
    try {
      await renameChat(renaming, title)
      setRenaming(null)
      setProblem(null)
      onRenamed()
    } catch (err) {
      setProblem((err as Error).message)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await deleteChat(deleting.id)
      onDeleted(deleting.id)
      setProblem(null)
    } catch (err) {
      setProblem((err as Error).message)
    }
    setDeleting(null)
  }

  return (
    <nav aria-label="Saved chats" className={`overflow-y-auto border-slate-200 p-2 ${className}`}>
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Chats (last 7 days)</h3>
      {error && (
        <p role="alert" className="mt-2 px-1 text-sm text-red-700">
          {error}{' '}
          <button type="button" className={LINK} onClick={onReload}>
            Try again
          </button>
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-2 px-1 text-sm text-red-700">
          {problem}
        </p>
      )}
      {chats === null && !error && <p className="mt-2 px-1 text-sm text-slate-600">Loading…</p>}
      {chats?.length === 0 && <p className="mt-2 px-1 text-sm text-slate-600">No chats yet.</p>}
      <ul className="mt-1 space-y-1">
        {chats?.map((chat) => (
          <li key={chat.id} className={`rounded-md ${chat.id === currentId ? 'bg-sky-50' : ''}`}>
            {renaming === chat.id ? (
              <form onSubmit={saveTitle} className="flex gap-1 p-1">
                <label htmlFor={`rename-${chat.id}`} className="sr-only">
                  Chat name
                </label>
                <input
                  id={`rename-${chat.id}`}
                  className={`${INPUT} py-1`}
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
                <button type="submit" className={`${BUTTON.primary} px-2 py-1`}>
                  Save
                </button>
              </form>
            ) : (
              <div className="flex items-start gap-1 p-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded px-1 text-left hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  onClick={() => onOpen(chat.id)}
                  aria-current={chat.id === currentId ? 'true' : undefined}
                >
                  <span className="block truncate text-sm text-slate-900">{chat.title}</span>
                  <span className="block text-xs text-slate-500">{formatMalaysiaDateTime(chat.updated_at)}</span>
                </button>
                <button
                  type="button"
                  className="rounded px-1 text-xs text-slate-600 hover:bg-slate-100"
                  onClick={() => {
                    setRenaming(chat.id)
                    setTitle(chat.title)
                  }}
                  aria-label={`Rename ${chat.title}`}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="rounded px-1 text-xs text-red-700 hover:bg-red-50"
                  onClick={() => setDeleting(chat)}
                  aria-label={`Delete ${chat.title}`}
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {deleting && (
        <Dialog title="Delete this chat?" onClose={() => setDeleting(null)}>
          <p className="text-sm text-slate-700">“{deleting.title}” will be removed from your chats.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BUTTON.secondary} onClick={() => setDeleting(null)}>
              Keep it
            </button>
            <button type="button" className={BUTTON.danger} onClick={() => void remove()}>
              Delete chat
            </button>
          </div>
        </Dialog>
      )}
    </nav>
  )
}
