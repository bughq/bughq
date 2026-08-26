import { env } from '@stacksjs/env'

/**
 * Canonical public URLs for things we render or email out (join links, alert
 * "view issue" links, reset links, the SDK snippet).
 *
 * These must be ABSOLUTE (scheme + host) to be usable in an email or a copied
 * snippet. `APP_URL` carries that in production (config/cloud.ts sets
 * `https://bughq.org`), but in local dev it's a bare host (`bughq.localhost`),
 * so we only trust it when it actually looks like a URL and otherwise fall back
 * to the local dev servers.
 */
function abs(value: unknown, fallback: string): string {
  const s = String(value || '').trim().replace(/\/$/, '')
  return /^https?:\/\//.test(s) ? s : fallback
}

/** Public web-app base — dashboard, join links, reset links. */
export function appUrl(): string {
  return abs(env.APP_URL, 'http://localhost:3100')
}

/**
 * Public base where `/sdk.js` and `/errors` are served — a separate host/port
 * from the web app in local dev. Prefers an explicit `BUGHQ_INGEST_URL`, then
 * `APP_URL` (same domain in prod), then the local ingest server.
 */
export function ingestUrl(): string {
  // process.env, not the typed `env` helper. storage/framework/env.d.ts is
  // generated from the .env FILE — which is untracked — so a key only present
  // on one machine types there and nowhere else. This is an optional
  // deployment override rather than part of the app's declared env schema, and
  // reading it through the typed accessor stopped compiling the moment stacks
  // 0.72 tightened StacksEnv. It was never promised; it just used to be
  // tolerated.
  return abs(process.env.BUGHQ_INGEST_URL || env.APP_URL, 'http://localhost:3108')
}
