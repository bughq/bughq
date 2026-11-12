/**
 * bughq - the HQ connect and usage endpoints.
 *
 * The contract every Stacks HQ service answers the same way, from
 * `@stacksjs/hq/service`. `buddy hq:connect` drives the first two and
 * `buddy hq:status` (and an app's own dashboard) reads the third.
 *
 *   POST /api/cli/connect                  -> 201 { code, approveUrl }
 *   GET  /api/cli/connect/{code}           -> 200 { status: 'pending' }
 *                                             200 { status: 'approved', project, ingestKey, readKey, dashboardUrl }  (once)
 *                                             404 { status: 'expired' }
 *   GET  /api/v1/usage   (Bearer read key) -> 200 [{ meter, used, limit, period, state, upgradeUrl }]
 *
 * and one of BugHQ's own, which the approve page (resources/views/cli/connect.stx)
 * posts to when the signed-in user confirms:
 *
 *   POST /api/cli/connect/{code}/approve   -> 200 { ok: true, project }
 *
 * Everything is under /api/ because the public origin routes only /api/* to
 * this server (see the note on /sdk.js in routes/errors.ts).
 */

import { route } from '@stacksjs/router'
import { rateLimit } from '../app/Errors/limits'
import { ProjectLimitError } from '../app/Hq/adapter'
import { hq } from '../app/Hq/service'
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
 * The request the package's handlers read.
 *
 * The router has already consumed the body into `jsonBody`, so a second
 * `request.json()` would throw and the connect would silently be named `app`.
 * Hand the parsed body over instead.
 */
function hqRequest(request: any): { url: string, method: string, headers: { get: (name: string) => string | null }, params: Record<string, string | undefined>, json: () => Promise<unknown> } {
  return {
    url: String(request.url ?? ''),
    method: String(request.method ?? 'GET'),
    headers: { get: (name: string) => request.headers?.get?.(name) ?? null },
    params: request.params ?? {},
    json: async () => request.jsonBody ?? {},
  }
}

// The package's handlers do not rate-limit; that is this router's job.
//
// Starting a connect writes a row, and nothing about the caller is known yet,
// so it gets the tight one. Ten a minute is far more than a person running
// `buddy hq:connect` needs and far fewer than filling the table takes.
const START_LIMIT = 10
// A CLI polls every couple of seconds for up to ten minutes.
const POLL_LIMIT = 120
const WINDOW_MS = 60_000

route.post('/api/cli/connect', async (request: any) => {
  const limit = await rateLimit(`connect:${clientIp(request)}`, START_LIMIT, WINDOW_MS)
  if (!limit.ok)
    return json({ error: 'rate limited' }, 429, { 'Retry-After': String(limit.retryAfter) })
  return hq.startConnect(hqRequest(request))
}).skipCsrf() // called by a CLI: no browser, no CSRF cookie

route.get('/api/cli/connect/{code}', async (request: any) => {
  const limit = await rateLimit(`connect-poll:${clientIp(request)}`, POLL_LIMIT, WINDOW_MS)
  if (!limit.ok)
    return json({ error: 'rate limited' }, 429, { 'Retry-After': String(limit.retryAfter) })
  return hq.pollConnect(hqRequest(request), String(request.params?.code ?? ''))
})

// The signed-in user confirms on the approve page. This is the one step a
// person takes, and the only one that touches an account: it creates or reuses
// the project named after the app and seals its keys for the waiting CLI.
//
// Cookie-authenticated and CSRF-exempt like the other dashboard endpoints, so
// it carries the same origin check they do. Approving is exactly the request a
// hostile page would want to forge: it would hand that page's own code the
// visitor's keys.
route.post('/api/cli/connect/{code}/approve', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)

  try {
    const result = await hq.approveConnect(String(request.params?.code ?? ''), user)
    if (result.ok)
      return json({ ok: true, project: result.project })
    if (result.reason === 'already_approved')
      return json({ error: 'This request was already approved.', reason: result.reason }, 409)
    return json({ error: 'This request has expired. Run the command again for a new link.', reason: result.reason }, 404)
  }
  catch (error) {
    if (error instanceof ProjectLimitError)
      return json({ error: error.message, upgrade: '/pricing' }, 402)
    console.error('[hq] connect approval failed:', error instanceof Error ? error.message : error)
    return json({ error: 'Could not approve this request. Please try again.' }, 500)
  }
}).skipCsrf()

route.get('/api/v1/usage', (request: any) => hq.usage(hqRequest(request)))
