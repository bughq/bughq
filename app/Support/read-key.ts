/**
 * A project's read key: the credential a machine presents to read that
 * project's issues.
 *
 * The ingest key next to it is deliberately public — it ships inside client
 * bundles, it only permits writes to one project, and the ingest route
 * compares it with `===` because nothing is lost by leaking it. A read key is
 * the opposite on both counts: it returns data, and it is meant to sit in a
 * server's configuration and nowhere else. So it is longer, it is compared in
 * constant time, and it is never accepted on an ingest route.
 *
 * It authorises exactly one project. There is no account behind it, so it
 * outlives the person who created it and carries none of their scope — which
 * is the whole reason it exists (bughq/bughq#19): a Stacks dashboard
 * reading errors server-to-server should not be holding somebody's session.
 */

/**
 * `bughq_read_` then 256 bits of hex.
 *
 * The prefix is doing real work. It tells a read key apart from a user's
 * bearer token before either is verified, so a read key is never handed to
 * `Auth.getUserFromToken` — the same reason `bughq_up_` upload tokens are
 * excluded there (app/Support/access.ts); and it gives secret scanners something to match, so
 * a key pasted into a repository can be found and revoked.
 */
const PREFIX = 'bughq_read_'
const BODY = /^[0-9a-f]{64}$/

export function newReadKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  return PREFIX + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Whether a presented credential is shaped like a read key at all. */
export function looksLikeReadKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX) && BODY.test(value.slice(PREFIX.length))
}

/**
 * Equal, in time that does not depend on how much of the key is right.
 *
 * `===` on a string short-circuits at the first differing byte, which leaks
 * the length of a correct prefix to anyone who can measure the response. That
 * is a real attack on a secret an attacker can guess at repeatedly, and not
 * one on the public ingest key, which is why only this side does it.
 */
export function sameKey(presented: string, stored: string): boolean {
  if (presented.length !== stored.length)
    return false
  let diff = 0
  for (let i = 0; i < presented.length; i++)
    diff |= presented.charCodeAt(i) ^ stored.charCodeAt(i)
  return diff === 0
}

export interface ReadKeyProject {
  id: string
  read_key?: string | null
  is_active?: boolean | number | null
}

export type ReadAuthorization =
  | { ok: true }
  | { ok: false, status: 401 | 403 | 404, error: string }

/**
 * Whether this key may read this project.
 *
 * A project nobody can name is a 404 rather than a 401: answering "that
 * project exists, your key is wrong" tells an unauthenticated caller which
 * project ids are real.
 */
export function authorizeRead(project: ReadKeyProject | null | undefined, presented: unknown): ReadAuthorization {
  if (!project)
    return { ok: false, status: 404, error: 'unknown project' }
  if (project.is_active === false || project.is_active === 0)
    return { ok: false, status: 403, error: 'project inactive' }
  // No key issued is not the same as "any key will do": a project without one
  // must refuse every presented key, including an empty one.
  if (!looksLikeReadKey(project.read_key))
    return { ok: false, status: 403, error: 'project has no read key' }
  if (!looksLikeReadKey(presented) || !sameKey(presented, project.read_key))
    return { ok: false, status: 401, error: 'invalid read key' }
  return { ok: true }
}

/**
 * How often a key's last-used stamp is written.
 *
 * The stamp is there so somebody can see whether a key is still in use before
 * revoking it, which a minute's resolution answers. Writing on every request
 * would put an UPDATE in front of every read of a log stream that a dashboard
 * polls.
 */
export const LAST_USED_RESOLUTION_MS = 60_000

export function shouldRecordUse(lastUsedAt: string | Date | null | undefined, now: Date): boolean {
  if (!lastUsedAt)
    return true
  const previous = lastUsedAt instanceof Date ? lastUsedAt.getTime() : Date.parse(String(lastUsedAt))
  if (Number.isNaN(previous))
    return true
  return now.getTime() - previous >= LAST_USED_RESOLUTION_MS
}
