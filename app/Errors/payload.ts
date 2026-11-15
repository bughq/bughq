import { isNativePlatform } from './native'

export const MAX_MESSAGE = 4096
export const MAX_STACK = 24 * 1024
export const MAX_METADATA_BYTES = 96 * 1024
export const MAX_BREADCRUMBS = 100

export interface IngestEnvelope {
  providedKey: string | null
  requestedProject: string | null
  errorType: string
  message: string
  stack?: string
  fingerprintParts: string[] | null
}

export type IngestEnvelopeResult =
  | { ok: true, value: IngestEnvelope }
  | { ok: false, error: 'missing message' }

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value
}

export function col255(value: unknown): string | null {
  if (value == null)
    return null
  const text = String(value)
  return text.length > 255 ? `${text.slice(0, 254)}…` : text
}

/**
 * The ingest key a request's headers carry.
 *
 * SDKs send `X-BugHQ-Key`. A plain error webhook (a self-hosted tool that
 * posts JSON to whatever URL its operator configured) only knows how to send
 * a token as `Authorization: Bearer`, so that is read too. The SDK header wins
 * when both are present.
 */
export function headerIngestKey(headers: { get: (name: string) => string | null } | null | undefined): string | null {
  const own = headers?.get('x-bughq-key')
  if (own != null && String(own).trim() !== '')
    return String(own).trim()
  const bearer = /^bearer\s+(\S+)\s*$/i.exec(String(headers?.get('authorization') ?? ''))
  return bearer ? bearer[1] : null
}

/**
 * The wire boundary shared by the browser, Vue, Nuxt, Stacks, PHP, and Laravel
 * SDKs. Keeping this pure makes their recorded payloads testable without a
 * database and prevents route code from quietly growing a second schema.
 */
export function parseIngestEnvelope(body: Record<string, any>, headerKey?: unknown): IngestEnvelopeResult {
  if (!body.message)
    return { ok: false, error: 'missing message' }

  return {
    ok: true,
    value: {
      providedKey: headerKey != null && String(headerKey) !== ''
        ? String(headerKey)
        : body.key != null && String(body.key) !== ''
          ? String(body.key)
          : null,
      requestedProject: body.project != null
        ? String(body.project)
        : body.p != null
          ? String(body.p)
          : null,
      errorType: clip(String(body.type ?? body.error_type ?? 'Error'), 255),
      message: clip(String(body.message), MAX_MESSAGE),
      stack: body.stack ? clip(String(body.stack), MAX_STACK) : undefined,
      fingerprintParts: Array.isArray(body.fingerprint) && body.fingerprint.length
        ? body.fingerprint.map((part: unknown) => String(part))
        : null,
    },
  }
}

export function buildMetadata(body: Record<string, unknown>): string | null {
  const metadata: Record<string, unknown> = {}
  if (body.extra && typeof body.extra === 'object')
    metadata.extra = body.extra
  // A plain webhook has no `extra` or `tags`; it sends what its author thought
  // relevant as `context`, the request id as `traceId`, and how many repeats it
  // held back as `suppressed`. Keep them where the issue page already looks.
  const webhook: Record<string, unknown> = {}
  if (body.context && typeof body.context === 'object' && !Array.isArray(body.context))
    Object.assign(webhook, body.context)
  if (typeof body.suppressed === 'number' && Number.isFinite(body.suppressed))
    webhook.suppressed = body.suppressed
  if (Object.keys(webhook).length)
    metadata.extra = { ...webhook, ...(metadata.extra as Record<string, unknown> | undefined) }
  if (body.tags && typeof body.tags === 'object')
    metadata.tags = body.tags
  if (typeof body.traceId === 'string' && body.traceId.trim() !== '')
    metadata.tags = { trace_id: body.traceId.trim().slice(0, 255), ...(metadata.tags as Record<string, unknown> | undefined) }
  if (body.contexts && typeof body.contexts === 'object')
    metadata.contexts = body.contexts
  if (Array.isArray(body.breadcrumbs) && body.breadcrumbs.length)
    metadata.breadcrumbs = body.breadcrumbs.slice(-MAX_BREADCRUMBS)
  if (body.sdk && typeof body.sdk === 'object')
    metadata.sdk = body.sdk
  if (body.session && typeof body.session === 'object')
    metadata.session = body.session
  // Native events: the platform and the (symbolicated) structured frames the
  // issue page renders instead of re-parsing the stack text.
  if (isNativePlatform(body.platform))
    metadata.platform = body.platform
  if (body.exception && typeof body.exception === 'object')
    metadata.exception = body.exception
  if (body.symbolication && typeof body.symbolication === 'object')
    metadata.symbolication = body.symbolication
  if (body.timestamp)
    metadata.client_timestamp = body.timestamp
  if (!Object.keys(metadata).length)
    return null

  const serialized = JSON.stringify(metadata)
  if (serialized.length <= MAX_METADATA_BYTES)
    return serialized

  // Over the cap. Breadcrumbs and extras go first; the frames are what make a
  // native crash readable at all, so they are the last thing dropped.
  const trimmed = JSON.stringify({
    sdk: metadata.sdk,
    session: metadata.session,
    platform: metadata.platform,
    contexts: metadata.contexts,
    exception: metadata.exception,
    symbolication: metadata.symbolication,
    client_timestamp: metadata.client_timestamp,
    _truncated: 'oversized metadata dropped',
  })
  if (trimmed.length <= MAX_METADATA_BYTES)
    return trimmed
  return JSON.stringify({
    sdk: metadata.sdk,
    session: metadata.session,
    platform: metadata.platform,
    client_timestamp: metadata.client_timestamp,
    _truncated: 'oversized metadata dropped',
  })
}
