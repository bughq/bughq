/**
 * bughq: the HQ connect and usage endpoints (`@stacksjs/hq/service`).
 *
 *   POST /api/cli/connect                 -> { code, approveUrl }
 *   GET  /api/cli/connect/{code}          -> pending | approved + keys (once) | expired
 *   GET  /api/v1/usage      (read key)    -> [{ meter, used, limit, period, state, upgradeUrl }]
 *   POST /api/cli/connect/{code}/approve  -> the approve page's action (signed-in user)
 *
 * `buddy hq:connect` drives the first two; the app's own dashboard reads the
 * third with the project's read key. All of them live under /api because the
 * public origin only routes /api/* to this server (see routes/errors.ts).
 */

import type { HqRequest } from '@stacksjs/hq/service'
import { route } from '@stacksjs/router'
import { ConnectRefusedError } from '../app/Hq/adapter'
import { hq } from '../app/Hq/service'
import { rateLimit } from '../app/Errors/limits'
import { currentUser } from '../app/Support/access'
import { clientIp } from '../app/Support/client-ip'
import { sameOrigin } from '../app/Support/origin'

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

/**
 * The router has already read the body into `jsonBody`, so the stream the
 * package would call `json()` on is spent. Hand it what was parsed.
 */
function hqRequest(request: any): HqRequest {
  return {
    url: String(request.url),
    method: request.method,
    headers: request.headers,
    params: request.params,
    json: async () => request.jsonBody ?? {},
  }
}

// Anyone can ask for a code, and each one is a row until it expires ten
// minutes later. Ten a minute per address is far more than a CLI needs and
// bounds what a script can pile up.
const START_LIMIT = 10
const START_WINDOW_MS = 60_000
// A CLI polls about once a second while the person approves.
const POLL_LIMIT = 120
const POLL_WINDOW_MS = 60_000

route.post('/api/cli/connect', async (request: any) => {
  const limit = await rateLimit(`hq-connect:${clientIp(request)}`, START_LIMIT, START_WINDOW_MS)
  if (!limit.ok)
    return json({ error: 'rate limited' }, 429, { 'Retry-After': String(limit.retryAfter) })
  return hq.startConnect(hqRequest(request))
}).skipCsrf() // called by a CLI: no browser, no cookie, nothing to forge

route.get('/api/cli/connect/{code}', async (request: any) => {
  const limit = await rateLimit(`hq-poll:${clientIp(request)}`, POLL_LIMIT, POLL_WINDOW_MS)
  if (!limit.ok)
    return json({ error: 'rate limited' }, 429, { 'Retry-After': String(limit.retryAfter) })
  return hq.pollConnect(hqRequest(request), String(request.params?.code ?? ''))
})

route.get('/api/v1/usage', (request: any) => hq.usage(hqRequest(request)))

// The approve page's button. Cookie-authenticated, so it carries the same
// Origin check as every other state-changing endpoint here: approving hands a
// project's keys to whoever holds the code, which is exactly what a forged
// cross-site POST would want.
route.post('/api/cli/connect/{code}/approve', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)

  try {
    const result = await hq.approveConnect(String(request.params?.code ?? ''), { id: Number(user.id) })
    if (!result.ok) {
      return json({
        error: result.reason === 'already_approved'
          ? 'This connection was already approved.'
          : 'This connection request has expired. Run the command again.',
        reason: result.reason,
      }, result.reason === 'already_approved' ? 409 : 410)
    }
    return json({ ok: true, project: result.project })
  }
  catch (error) {
    if (error instanceof ConnectRefusedError) {
      return json({
        error: error.message,
        reason: error.reason,
        ...(error.reason === 'project_limit' ? { upgrade: '/pricing' } : {}),
      }, error.reason === 'project_limit' ? 402 : 409)
    }
    console.error('[hq] could not approve connect:', error instanceof Error ? error.message : error)
    return json({ error: 'Could not approve the connection. Please try again.' }, 500)
  }
}).skipCsrf()
