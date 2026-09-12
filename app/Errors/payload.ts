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
  if (body.tags && typeof body.tags === 'object')
    metadata.tags = body.tags
  if (body.contexts && typeof body.contexts === 'object')
    metadata.contexts = body.contexts
  if (Array.isArray(body.breadcrumbs) && body.breadcrumbs.length)
    metadata.breadcrumbs = body.breadcrumbs.slice(-MAX_BREADCRUMBS)
  if (body.sdk && typeof body.sdk === 'object')
    metadata.sdk = body.sdk
  if (body.session && typeof body.session === 'object')
    metadata.session = body.session
  if (body.timestamp)
    metadata.client_timestamp = body.timestamp
  if (!Object.keys(metadata).length)
    return null

  const serialized = JSON.stringify(metadata)
  if (serialized.length <= MAX_METADATA_BYTES)
    return serialized

  return JSON.stringify({
    sdk: metadata.sdk,
    session: metadata.session,
    client_timestamp: metadata.client_timestamp,
    _truncated: 'oversized metadata dropped',
  })
}
