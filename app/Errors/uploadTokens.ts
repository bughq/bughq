import { createHash } from 'node:crypto'

/**
 * Upload tokens: the secret half of a project's credentials.
 *
 * The ingest key identifies a project and ships in every client bundle. An
 * upload token authorises build tooling to replace a release's symbols, so it
 * must never ship anywhere. See database/migrations/0000000043 for why these are
 * separate.
 *
 * Tokens are `bughq_up_` plus 40 base62 characters (~238 bits). The prefix
 * makes one recognisable to secret scanners and to a person reading a CI log;
 * only the SHA-256 is stored.
 */

export const UPLOAD_TOKEN_PREFIX = 'bughq_up_'
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function generateUploadToken(): string {
  const bytes = new Uint8Array(40)
  globalThis.crypto.getRandomValues(bytes)
  let out = UPLOAD_TOKEN_PREFIX
  // 248 is the largest multiple of 62 under 256; rejection keeps it unbiased.
  for (let i = 0; out.length < UPLOAD_TOKEN_PREFIX.length + 40; i++) {
    if (i >= bytes.length) {
      globalThis.crypto.getRandomValues(bytes)
      i = 0
    }
    if (bytes[i] < 248)
      out += ALPHABET[bytes[i] % 62]
  }
  return out
}

export function hashUploadToken(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex')
}

/** What the settings list shows after creation: enough to tell tokens apart. */
export function displayPrefix(token: string): string {
  return `${token.slice(0, UPLOAD_TOKEN_PREFIX.length + 6)}…`
}

/** Pull a token out of `Authorization: Bearer …`, rejecting anything that is not one. */
export function tokenFromAuthorization(header: string | null | undefined): string | null {
  const m = String(header ?? '').match(/^Bearer\s+(\S+)$/i)
  if (!m || !m[1].startsWith(UPLOAD_TOKEN_PREFIX))
    return null
  return m[1]
}
