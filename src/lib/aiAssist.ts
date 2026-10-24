import { ApiError, NETWORK_ERROR_MESSAGE, client } from './api'
import { supabaseConfig } from './supabase'

/**
 * Calls the `ai-assist` Edge Function (0009) with the signed-in person's
 * token: the supervisor Re-check, "Read from photo" and the insight wording.
 * Returns the JSON body; a refusal or failure becomes an `ApiError` with a
 * sentence that can be shown as it is. Gives up after `timeoutMs`.
 */
export async function callAiAssist<T>(body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  if (!supabaseConfig) throw new ApiError('The app is not connected to the database.')
  const { data } = await client().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiError('Your sign-in has expired. Sign in again.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/ai-assist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseConfig.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    if (controller.signal.aborted) throw new ApiError('This is taking too long. Try again.')
    throw new ApiError(NETWORK_ERROR_MESSAGE)
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 404 && !response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError('The assistant is not set up yet.')
  }
  const json = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
  if (!json) throw new ApiError('Something went wrong. Try again.')
  if (!response.ok && json.error?.message) throw new ApiError(json.error.message)
  if (!response.ok) throw new ApiError('Something went wrong. Try again.')
  return json
}
