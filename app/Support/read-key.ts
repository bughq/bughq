/**
 * A project's read key: the credential a machine presents to read that
 * project's issues.
 *
 * The ingest key next to it is deliberately public: it ships inside client
 * bundles and only permits writes to one project. A read key is the opposite
 * on both counts: it returns data, and it is meant to sit in a server's
 * configuration and nowhere else.
 *
 * It authorises exactly one project. There is no account behind it, so it
 * outlives the person who created it and carries none of their scope, which
 * is the whole reason it exists (bughq/bughq#19): a Stacks dashboard reading
 * errors server-to-server should not be holding somebody's session.
 *
 * A read key is a project token carrying `project:read`
 * (app/Support/project-tokens.ts): a Stacks personal access token owned by
 * the project's principal, hashed at rest, expiring and revocable. This file
 * used to mint, shape-check and compare its own, kept in a column of the
 * projects table in the clear. Nothing here generates, stores or compares a credential now;
 * what is left is the name a key is listed under.
 *
 * A project can hold more than one: `buddy hq:connect` mints one per connect,
 * so a second machine gets its own without the first one's being rotated out
 * from under it, and each can be revoked alone.
 */

/** What a key minted from the settings page is called. */
export const SETTINGS_READ_KEY_NAME = 'Read key'

/** What a key handed to `buddy hq:connect` is called: the app it was connected for. */
export function connectReadKeyName(app: string): string {
  const name = String(app ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
  return name ? `Connected: ${name}` : 'Connected app'
}
