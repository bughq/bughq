import { env } from '@stacksjs/env'

/**
 * Is this request's `Origin` one of ours?
 *
 * A CSRF guard for the JSON endpoints: a browser attaches `Origin` to every
 * cross-site POST, so rejecting the ones that are not ours stops a third-party
 * page driving the API with the visitor's cookies. Requests with no `Origin` at
 * all are allowed through, because that is what a same-origin GET, a server to
 * server call and curl all look like, and the endpoints behind this still
 * require a session.
 *
 * ## Why this compares against configuration and not the Host header
 *
 * It used to read the host off the request:
 *
 *     const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
 *     return new URL(origin).host === host
 *
 * which meant resolving an issue returned 403 for every user, in production,
 * for as long as the app has been behind a proxy. rpx proxies to
 * `localhost:3022` and sets no forwarded headers on the HTTP path, so the app
 * saw `Host: localhost:3022` while the browser sent `Origin: https://bughq.org`.
 * The two could never match. It failed identically on the old dedicated box and
 * the shared one, so it was never a deployment problem.
 *
 * Comparing against `APP_URL` is also the more correct question. `Host` is
 * whatever the last hop chose to send; it is not a statement about who this
 * application is. `APP_URL` is exactly that statement, and it is already the
 * value every absolute link is built from (see ./urls.ts).
 *
 * `www.` is accepted alongside the bare host because the redirect to the apex
 * is a hop the browser makes AFTER the preflight, so an `Origin` can legitimately
 * carry the `www.` form.
 */
export function sameOrigin(request: { headers?: { get?: (name: string) => string | null } }): boolean {
  const origin = request.headers?.get?.('origin')
  if (!origin)
    return true

  let originHost: string
  try {
    originHost = new URL(origin).host
  }
  catch {
    // A malformed Origin is not something any browser of ours sent.
    return false
  }

  return allowedHosts().has(originHost)
}

/**
 * The hosts this app answers to, from configuration.
 *
 * Read on every call rather than memoized at module load: `@stacksjs/config`
 * resolves overrides asynchronously, so a value captured at import time can be
 * the default rather than the configured one.
 */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>()

  for (const configured of [env.APP_URL, env.APP_DOMAIN]) {
    const raw = String(configured ?? '').trim()
    if (!raw)
      continue
    try {
      // APP_URL carries a scheme in production (`https://bughq.org`) and does
      // not in local dev (`stacks.localhost`). URL needs one either way.
      hosts.add(new URL(raw.includes('://') ? raw : `https://${raw}`).host)
    }
    catch {}
  }

  for (const host of [...hosts])
    hosts.add(host.startsWith('www.') ? host.slice(4) : `www.${host}`)

  return hosts
}
