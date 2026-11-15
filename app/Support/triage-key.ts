import { looksLikeReadKey, sameKey } from './read-key'

/**
 * A project's triage key: the credential a machine presents to change the
 * status of that project's issues.
 *
 * The read key beside it reads and cannot write. This one writes exactly one
 * thing, an issue's status, and reads nothing: the two are issued, replaced
 * and revoked on their own, so a deploy script that resolves what it fixed
 * holds no credential that returns error data, and a dashboard that reads
 * holds none that can close an issue.
 *
 * Like a read key it authorises one project and has no account behind it. A
 * release pipeline or an agent marking issues resolved should not be holding
 * somebody's session to do it.
 */

/**
 * `bughq_triage_` then 256 bits of hex.
 *
 * The prefix keeps a triage key out of `Auth.getUserFromToken` and apart from
 * a read key before either is verified (app/Support/access.ts), and gives
 * secret scanners something to match.
 */
const PREFIX = 'bughq_triage_'
const BODY = /^[0-9a-f]{64}$/

export function newTriageKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  return PREFIX + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Whether a presented credential is shaped like a triage key at all. */
export function looksLikeTriageKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX) && BODY.test(value.slice(PREFIX.length))
}

/** A bearer that names a project rather than a person: never a session. */
export function looksLikeProjectKey(value: unknown): value is string {
  return looksLikeReadKey(value) || looksLikeTriageKey(value)
}

export interface TriageKeyProject {
  id: string
  triage_key?: string | null
  is_active?: boolean | number | null
}

export type TriageAuthorization =
  | { ok: true }
  | { ok: false, status: 401 | 403 | 404, error: string }

/**
 * Whether this key may triage this project.
 *
 * The same answers authorizeRead gives, for the same reasons: an unknown
 * project is a 404 so project ids cannot be probed, and a project with no key
 * issued refuses every key rather than accepting an empty one.
 */
export function authorizeTriage(project: TriageKeyProject | null | undefined, presented: unknown): TriageAuthorization {
  if (!project)
    return { ok: false, status: 404, error: 'unknown project' }
  if (project.is_active === false || project.is_active === 0)
    return { ok: false, status: 403, error: 'project inactive' }
  if (!looksLikeTriageKey(project.triage_key))
    return { ok: false, status: 403, error: 'project has no triage key' }
  if (!looksLikeTriageKey(presented) || !sameKey(presented, project.triage_key))
    return { ok: false, status: 401, error: 'invalid triage key' }
  return { ok: true }
}

/** The most issue ids one bulk status change may name. */
export const MAX_BULK_TRIAGE = 200

/**
 * The ids a bulk request names: strings, de-duplicated, in the order given.
 * Null when the body is not a non-empty list of ids within the limit, so the
 * route answers 400 instead of updating part of a malformed request.
 */
export function bulkIssueIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_TRIAGE)
    return null
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^[\w-]{1,64}$/.test(entry))
      return null
    if (!ids.includes(entry))
      ids.push(entry)
  }
  return ids
}
