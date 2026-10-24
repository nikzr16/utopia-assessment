/**
 * The part of OpenAI's Responses API ai-assist uses (0009): one request, one
 * strict-JSON answer (`text.format` json_schema). No tools: every step asks
 * for a fixed JSON shape, and the server checks every value before using it.
 * Plain TypeScript; `index.ts` wires the real `openai` client, tests a fake.
 */

export type JsonSchema = Record<string, unknown>

/** A message for the model; content parts are text, an image or a file. */
export type AiInputItem = Record<string, unknown>

export interface JsonAiRequest {
  instructions: string
  input: AiInputItem[]
  /** Name and schema of the JSON the model must return (strict). */
  format: { name: string; schema: JsonSchema }
  maxOutputTokens: number
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
}

export interface JsonAiResponse {
  /** The model's output text (the JSON). */
  text: string
  usage?: Usage | null
}

export interface JsonAiClient {
  respond(request: JsonAiRequest, signal: AbortSignal): Promise<JsonAiResponse>
}

/** The AI service refused the key (not set up) or could not answer. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_set_up' | 'unavailable',
  ) {
    super(message)
  }
}

export class AiTimeout extends Error {}

/** The outcome of one AI step, for the AI log. */
export type AiFailure = 'not_set_up' | 'ai_unavailable' | 'timeout'

/**
 * Ask the model and parse its JSON. Throws AiError (key / service), AiTimeout
 * (over `timeoutMs`), or AiError('unavailable') for output that is not JSON.
 */
export async function askJson(
  ai: JsonAiClient | null,
  request: JsonAiRequest,
  timeoutMs: number,
): Promise<{ value: unknown; usage: Usage | null }> {
  if (!ai) throw new AiError('OPENAI_API_KEY is not set', 'not_set_up')
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const response = await ai.respond(request, controller.signal)
    try {
      return { value: JSON.parse(response.text), usage: response.usage ?? null }
    } catch {
      throw new AiError('The model did not return JSON', 'unavailable')
    }
  } catch (e) {
    if (timedOut) throw new AiTimeout(`No answer within ${timeoutMs} ms`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Map an error from askJson to the AI log outcome (null: not an AI failure). */
export function aiFailure(e: unknown): AiFailure | null {
  if (e instanceof AiTimeout) return 'timeout'
  if (e instanceof AiError) return e.kind === 'not_set_up' ? 'not_set_up' : 'ai_unavailable'
  return null
}

const s = (description: string) => ({ type: 'string', description })

/** Strict-schema helpers (every property required, no extras). */
export function object(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}
export const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description })
export const string = s
export const boolean = (description: string): JsonSchema => ({ type: 'boolean', description })
export const integer = (description: string): JsonSchema => ({ type: 'integer', description })
export const array = (items: JsonSchema, description: string): JsonSchema => ({ type: 'array', items, description })

/** Collapse spaces and cut to `max` characters. */
export function clean(text: unknown, max: number): string {
  if (typeof text !== 'string') return ''
  return text.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}
