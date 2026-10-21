/**
 * The one fetch helper. Every non-2xx response carries the backend's error
 * envelope `{error: {error_code, message, retryable}}`; anything else (an
 * HTML 502 from a proxy, a refused connection) becomes a plain ApiError, and
 * a raw body never reaches a message.
 */

import type { components } from './schema'

export type ErrorCode = components['schemas']['ErrorCode']
type ErrorBody = components['schemas']['ApiErrorBody']
type Envelope = components['schemas']['ErrorEnvelope']

export const DEFAULT_TIMEOUT_MS = 10_000

export const NO_ANSWER_MESSAGE = 'The server did not answer.'
export const TIMEOUT_MESSAGE = 'The server took too long to answer.'

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  /** The HTTP status, or 0 when no response arrived. */
  readonly status: number

  constructor(
    code: ErrorCode,
    message: string,
    retryable: boolean,
    status: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryable = retryable
    this.status = status
  }
}

export interface RequestOptions {
  query?: object
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  /** Non-2xx statuses whose body is the route's own response, not an envelope. */
  accept?: readonly number[]
}

// tsc fails here when the contract gains or loses a code, so the list cannot drift.
const ERROR_CODES = {
  VALIDATION_ERROR: true,
  NOT_FOUND: true,
  CONFLICT: true,
  METHOD_NOT_ALLOWED: true,
  MODEL_ERROR: true,
  EMBEDDING_ERROR: true,
  VECTOR_RETRIEVAL_ERROR: true,
  GRAPH_QUERY_ERROR: true,
  CONTEXT_BUILD_ERROR: true,
  INTERRUPTED: true,
  CANCELLED: true,
  RUN_ERROR: true,
  CONFIGURATION_ERROR: true,
} satisfies Record<ErrorCode, true>

const knownCode = (code: string): ErrorCode =>
  code in ERROR_CODES ? (code as ErrorCode) : 'RUN_ERROR'

/** A failure with no usable envelope; retrying helps only when the server or network was at fault. */
const noAnswer = (status: number) =>
  new ApiError(
    'RUN_ERROR',
    NO_ANSWER_MESSAGE,
    status === 0 || status >= 500,
    status,
  )

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return false
  const error = value.error as Partial<ErrorBody> | null
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof error.error_code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.retryable === 'boolean'
  )
}

function withQuery(path: string, query: object | undefined): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const text = params.toString()
  return text === '' ? path : `${path}?${text}`
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  {
    query,
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    accept = [],
  }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onCallerAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) onCallerAbort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    const response = await fetch(withQuery(path, query), {
      method,
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await readJson(response)
    if (response.ok || accept.includes(response.status)) {
      if (payload === undefined) throw noAnswer(response.status)
      return payload as T
    }
    if (isEnvelope(payload)) {
      const { error_code, message, retryable } = payload.error
      throw new ApiError(
        knownCode(error_code),
        message,
        retryable,
        response.status,
      )
    }
    throw noAnswer(response.status)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (timedOut) throw new ApiError('RUN_ERROR', TIMEOUT_MESSAGE, true, 0)
    if (signal?.aborted) throw error
    throw noAnswer(0)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
