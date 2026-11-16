/**
 * Upload tokens: the secret half of a project's credentials.
 *
 * The ingest key identifies a project and ships in every client bundle. An
 * upload token authorises build tooling to replace a release's symbols, so it
 * must never ship anywhere.
 *
 * An upload token is a project token carrying `project:upload`
 * (app/Support/project-tokens.ts): a Stacks personal access token owned by
 * the project's principal, hashed at rest, named, expiring and revocable.
 * `POST /api/debug-files` has no project in its URL, because build tooling is
 * handed one secret (`BUGHQ_UPLOAD_TOKEN`) and nothing else; the token's owner
 * is what says where its uploads go.
 *
 * Nothing here generates, stores or compares a credential. What is left is a
 * label for the list and how the bearer is read off the request.
 */

/** A label for the list. Blank becomes a default so a row is never nameless. */
export function uploadTokenName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'CI'
}

/** Pull the bearer out of `Authorization: Bearer ...`, or null. */
export function tokenFromAuthorization(header: string | null | undefined): string | null {
  const m = String(header ?? '').match(/^Bearer\s+(\S+)$/i)
  return m ? m[1]! : null
}
