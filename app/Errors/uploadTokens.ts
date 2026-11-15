/**
 * Upload tokens: the secret half of a project's credentials.
 *
 * The ingest key identifies a project and ships in every client bundle. An
 * upload token authorises build tooling to replace a release's symbols, so it
 * must never ship anywhere.
 *
 * An upload token is a Stacks personal access token (`createToken`,
 * `findToken`, `tokens`, `revokeTokenById` in @stacksjs/auth): hashed at
 * rest, named, expiring and revocable. This file used to generate, hash and
 * prefix its own, with an `upload_tokens` table to keep them in. What is left
 * is the one thing the framework cannot know: which project a token uploads
 * to.
 *
 * That is carried in the token's scope. `POST /api/debug-files` has no
 * project in its URL, because build tooling is handed one secret
 * (`BUGHQ_UPLOAD_TOKEN`) and nothing else, so the token itself has to say
 * where its uploads go. The scope is `symbols:upload:<project id>`: it names
 * the one thing the token may do and the one project it may do it to, and it
 * grants nothing else. A token holding it cannot read issues, change one, or
 * pass as its owner (app/Support/access.ts).
 */

const UPLOAD_SCOPE_PREFIX = 'symbols:upload:'

/** The scope that lets a token upload debug files to one project. */
export function uploadScope(projectId: string): string {
  return `${UPLOAD_SCOPE_PREFIX}${projectId}`
}

/**
 * The project a token's scopes let it upload to, or null.
 *
 * Null for a full session: `*` is a person signed in, not an upload token,
 * and it names no project. Null too when the scopes name more than one
 * project, which nothing here creates: an upload has to land in exactly one
 * place, so an ambiguous token is refused rather than guessed at.
 */
export function uploadProject(scopes: readonly string[]): string | null {
  if (scopes.includes('*'))
    return null
  const projects = scopes
    .filter(scope => scope.startsWith(UPLOAD_SCOPE_PREFIX))
    .map(scope => scope.slice(UPLOAD_SCOPE_PREFIX.length))
    .filter(Boolean)
  return projects.length === 1 ? projects[0]! : null
}

/** A label for the list. Blank becomes a default so a row is never nameless. */
export function uploadTokenName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'CI'
}

/**
 * How long an upload token lasts.
 *
 * It sits in a CI secret and is used on every release build, so it is given
 * the longest life a framework token is given here rather than one that
 * breaks a pipeline on an anniversary. It is revocable at any point.
 */
export const UPLOAD_TOKEN_LIFETIME_DAYS = 3650

export function uploadTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + UPLOAD_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
}

/** Pull the bearer out of `Authorization: Bearer ...`, or null. */
export function tokenFromAuthorization(header: string | null | undefined): string | null {
  const m = String(header ?? '').match(/^Bearer\s+(\S+)$/i)
  return m ? m[1]! : null
}
