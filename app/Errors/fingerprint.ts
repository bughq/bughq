/**
 * Error grouping + classification helpers for bughq.
 *
 * A fingerprint collapses many occurrences of "the same" error into one Issue.
 * We derive it from the error type + a normalized message + the top
 * application stack frame, so noise (ids, addresses, line/col drift) doesn't
 * split one bug into thousands of issues.
 */

import { createHash } from 'node:crypto'

/** Strip volatile tokens so equivalent messages fingerprint identically. */
export function normalizeMessage(message: string): string {
  return (message || '')
    .replace(/0x[0-9a-f]+/gi, '0xADDR') // pointers
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'UUID')
    .replace(/\b\d+\b/g, 'N') // ids, counts, line numbers
    .replace(/(['"]).*?\1/g, '$1…$1') // quoted literals
    .trim()
    .slice(0, 300)
}

/** The first stack frame that looks like application (not vendor) code. */
export function topFrame(stack: string | undefined): string {
  if (!stack)
    return ''
  const lines = stack.split('\n').map(l => l.trim()).filter(Boolean)
  const appFrame = lines.find(l => /\bat\b/.test(l) && !/node_modules|node:internal/.test(l))
  const frame = appFrame ?? lines[1] ?? ''
  // Drop the :line:col suffix so small drift doesn't change the fingerprint.
  return frame.replace(/:\d+:\d+\)?$/, '').replace(/0x[0-9a-f]+/gi, '')
}

/**
 * A frame without the part of its path that names one deploy.
 *
 * A server keeps each release in its own directory
 * (`/var/www/app/releases/2f9ed4289/app/Jobs/SyncJob.ts`), so the same line of
 * the same file had a different frame after every deploy, and the same error
 * opened a new issue per release: one job's failure stood as three issues over
 * a day. The issue list still shows the frame as it was reported (`culprit`).
 */
export function releaseIndependent(frame: string): string {
  return frame.replace(/\/releases\/[^/\s]+\//g, '/releases/*/')
}

/** Stable group key for an error. */
export function fingerprint(errorType: string, message: string, stack?: string): string {
  const basis = `${errorType || 'Error'}|${normalizeMessage(message)}|${releaseIndependent(topFrame(stack))}`
  return createHash('sha256').update(basis).digest('hex').slice(0, 32)
}

/**
 * Group key from a client-supplied override (`event.fingerprint`). Lets an SDK
 * force related errors into one issue (or split one apart) regardless of the
 * derived type/message/frame. Parts are joined stably before hashing.
 */
export function fingerprintFromParts(parts: string[]): string {
  const basis = parts.map(p => String(p ?? '').trim()).filter(Boolean).join('|')
  return createHash('sha256').update(basis || 'default').digest('hex').slice(0, 32)
}

/** Human-friendly issue title: "TypeError: cannot read property …". */
export function issueTitle(errorType: string, message: string): string {
  const type = errorType || 'Error'
  const msg = (message || '').split('\n')[0].slice(0, 240)
  return msg ? `${type}: ${msg}` : type
}

/** Where the error came from — the top app frame, for the issue list. */
export function culprit(stack: string | undefined): string {
  const frame = topFrame(stack)
  const m = frame.match(/at\s+(.+)/)
  return (m?.[1] ?? frame).slice(0, 240)
}

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/TypeError|is not a function|cannot read propert/i, 'type'],
  [/ReferenceError|is not defined/i, 'reference'],
  [/SyntaxError|Unexpected token/i, 'syntax'],
  [/NetworkError|Failed to fetch|ERR_|timeout/i, 'network'],
  [/SecurityError|CORS|Content Security Policy/i, 'security'],
  [/RangeError|Maximum call stack/i, 'range'],
]

/** Coarse category used for filtering/grouping in the dashboard. */
export function categorize(errorType: string, message: string): string {
  const hay = `${errorType} ${message}`
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(hay))
      return cat
  }
  return 'other'
}

/** A short, URL-safe id for event / issue primary keys. */
export function randomId(): string {
  return createHash('sha256').update(globalThis.crypto.randomUUID()).digest('hex').slice(0, 24)
}
