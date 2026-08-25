/**
 * bughq — error ingest + issue API.
 *
 * The browser/server SDK (served at `/sdk.js`) POSTs captured errors to
 * `/errors`. Each event is fingerprinted and rolled up into an Issue (the
 * triage unit). The dashboard reads issues from `GET /api/projects/{id}/issues`.
 * Storage is Postgres, queried through bun-query-builder's `db`.
 */

import { Auth } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { response, route } from '@stacksjs/router'
import { dispatchAlerts } from '../app/Errors/alerts'
import { categorize, culprit, fingerprint, fingerprintFromParts, issueTitle, randomId } from '../app/Errors/fingerprint'
import { authorizeIngest } from '../app/Errors/ingest'
import { allowAlert, rateLimit } from '../app/Errors/limits'
import { ingestUrl } from '../app/Support/urls'

// Ingest abuse bounds. The public key gate is not enough on its own - a script
// with the key (readable from any bundle) could flood the ingest.
const MAX_BODY_BYTES = 256 * 1024 // reject payloads larger than this outright
const MAX_MESSAGE = 4096 // stored message cap
const MAX_STACK = 24 * 1024 // stored stack cap
const MAX_METADATA_BYTES = 96 * 1024 // stored metadata JSON cap
const MAX_BREADCRUMBS = 100 // keep the most recent N
// Fixed-window quotas (per process): per project, and per client IP across
// projects. Generous enough for a real error storm's client-deduped traffic,
// tight enough to kill a Postman flood.
const PROJECT_LIMIT = 120
const IP_LIMIT = 300
const RATE_WINDOW_MS = 10_000

// Number of trusted reverse-proxy / load-balancer hops in front of the app.
// X-Forwarded-For is built left-to-right (client, proxy1, proxy2, …), so the
// real client sits at index (length - TRUSTED_PROXY_HOPS). Counting from the
// RIGHT means a client can only forge entries we then skip over — taking the
// leftmost value (as before) let anyone spoof their IP and dodge the per-IP
// quota. Default 1 (a single edge LB); set TRUSTED_PROXY_HOPS to match your
// topology, or 0 if the app is exposed directly (XFF is then ignored).
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS ?? 1))

function clientIp(request: any): string {
  const direct = request.headers?.get('x-real-ip') || request.ip || 'unknown'
  if (TRUSTED_PROXY_HOPS === 0)
    return direct
  const xff = request.headers?.get('x-forwarded-for')
  if (xff) {
    const hops = String(xff).split(',').map((s: string) => s.trim()).filter(Boolean)
    if (hops.length) {
      const idx = hops.length - TRUSTED_PROXY_HOPS
      return hops[idx >= 0 ? idx : 0]
    }
  }
  return direct
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value
}

// Hard cap for varchar(255) columns. Postgres RAISES on overflow, which aborts
// the whole INSERT and drops the event — so every client-supplied or derived
// string bound for a 255-char column passes through here first. Note plain
// `clip(x, 255)` is NOT safe for these: its "…[truncated]" suffix pushes the
// result past 255. Returns null for nullish input so it drops straight in.
function col255(value: unknown): string | null {
  if (value == null)
    return null
  const s = String(value)
  return s.length > 255 ? `${s.slice(0, 254)}…` : s
}

/**
 * Bundle the SDK's rich fields into a single JSON blob stored in
 * `error_events.metadata` (widened to hold it, migration 0129). Keeps a flat,
 * predictable shape the issue-detail page can destructure, and stays null when
 * a bare/legacy client sends nothing extra.
 */
function buildMetadata(body: any): string | null {
  const meta: Record<string, unknown> = {}
  if (body.extra && typeof body.extra === 'object')
    meta.extra = body.extra
  if (body.tags && typeof body.tags === 'object')
    meta.tags = body.tags
  if (body.contexts && typeof body.contexts === 'object')
    meta.contexts = body.contexts
  // Keep only the most recent breadcrumbs so a client can't balloon the row.
  if (Array.isArray(body.breadcrumbs) && body.breadcrumbs.length)
    meta.breadcrumbs = body.breadcrumbs.slice(-MAX_BREADCRUMBS)
  if (body.sdk && typeof body.sdk === 'object')
    meta.sdk = body.sdk
  if (body.session && typeof body.session === 'object')
    meta.session = body.session
  if (body.timestamp)
    meta.client_timestamp = body.timestamp
  if (!Object.keys(meta).length)
    return null
  const serialized = JSON.stringify(meta)
  // Hard size ceiling on the whole blob: if a caller stuffs huge extra/tags,
  // drop the free-form fields and keep the small structured ones rather than
  // storing an unbounded document.
  if (serialized.length <= MAX_METADATA_BYTES)
    return serialized
  const trimmed = JSON.stringify({
    sdk: meta.sdk,
    session: meta.session,
    client_timestamp: meta.client_timestamp,
    _truncated: 'oversized metadata dropped',
  })
  return trimmed
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-BugHQ-Key',
  'Access-Control-Max-Age': '86400',
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders } })
}

// Resolve the current user from a bearer token (API calls) or the `token`
// cookie (the resolve form posts with cookies, no bearer). Used to owner-scope
// the issue endpoints so no tenant can read/mutate another tenant's issues.
async function userFromRequest(request: any): Promise<any | null> {
  const authHeader = request.headers?.get?.('authorization') ?? ''
  let token = request.bearerToken?.() ?? authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    // `bughq_token`, which is the only session cookie this app has ever set
    // (resources/stores/session.ts). This read `token=` and could never match:
    // the pattern anchors on start-of-string or `;`, and in `bughq_token=…` the
    // character before `token=` is `_`. Nothing anywhere writes a bare `token`
    // cookie, so the cookie branch was dead.
    //
    // It only showed on /issue/{id}/status, the one caller with no other way in
    // — a plain HTML form POST carries no Authorization header — so Resolve,
    // Ignore and Reopen answered 401 on every click and dropped the user on a
    // raw JSON error page. The other callers are fetches that send a bearer
    // token, which is why the dead branch stayed invisible.
    const cookie = request.headers?.get?.('cookie') ?? ''
    const m = cookie.match(/(?:^|;)\s*bughq_token=([^;]+)/)
    if (m)
      token = decodeURIComponent(m[1])
  }
  if (!token)
    return null
  try {
    return await Auth.getUserFromToken(token)
  }
  catch {
    return null
  }
}

/** The user's email, lowercased, for case-insensitive membership matching. */
function userEmail(user: any): string {
  return String(user?.email ?? '').trim().toLowerCase()
}

// CSRF belt-and-suspenders for the cookie-authenticated, CSRF-exempt issue
// endpoints. These accept a `token` cookie and are `.skipCsrf()`, so SameSite
// (Lax) is the only thing stopping a cross-site POST today. When the browser
// sends an Origin, require it to match this host; a forged cross-site request
// carries the attacker's Origin and is rejected. Absent Origin (non-browser
// callers, some same-origin form posts) falls through to the cookie+SameSite
// gate, and bearer-token API calls are same-origin anyway.
function sameOrigin(request: any): boolean {
  const origin = request.headers?.get?.('origin')
  if (!origin)
    return true
  try {
    const host = request.headers?.get?.('x-forwarded-host') || request.headers?.get?.('host') || new URL(request.url).host
    return new URL(origin).host === host
  }
  catch {
    return false
  }
}

/**
 * True when `user` can access the issue: they own the project it belongs to, or
 * they're an invited member of it. Viewing and triage (resolve/ignore) are open
 * to members; only administrative actions are owner-only (see routes/projects).
 */
async function ownsIssue(user: any, issueId: string): Promise<boolean> {
  const row = (await db.unsafe(
    `SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id
     WHERE i.id = $1 AND (
       p.owner_id = $2
       OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND lower(m.email) = $3)
     ) LIMIT 1`,
    [issueId, Number(user.id), userEmail(user)],
  ))?.[0]
  return !!row
}

/** True when `user` can access the project (owner or invited member). */
async function ownsProject(user: any, projectId: string): Promise<boolean> {
  const row = (await db.unsafe(
    `SELECT 1 FROM projects p
     WHERE p.id = $1 AND (
       p.owner_id = $2
       OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND lower(m.email) = $3)
     ) LIMIT 1`,
    [projectId, Number(user.id), userEmail(user)],
  ))?.[0]
  return !!row
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

route.options('/errors', () => new Response(null, { status: 204, headers: CORS }))

route.post('/errors', async (request: any) => {
  // Size cap first: reject oversized payloads before any work. Trust the
  // Content-Length header for the cheap early-out; the router already parsed
  // the body, but rejecting here still bounds what we store and validate.
  const declaredLen = Number(request.headers?.get('content-length') || 0)
  if (declaredLen > MAX_BODY_BYTES)
    return json({ error: 'payload too large' }, 413)

  const body = request.jsonBody ?? {}
  // Content-Length is client-supplied (spoofable, and absent on chunked
  // requests), so the header check above is only a cheap early-out. Bound the
  // ACTUAL parsed payload too, or an understated/missing length slips past.
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES)
    return json({ error: 'payload too large' }, 413)
  if (!body.message)
    return json({ error: 'missing message' }, 400)

  // Per-IP quota across all projects (blunts a broad flood before we even hit
  // the DB for the project lookup).
  const ip = clientIp(request)
  const ipLimit = await rateLimit(`ip:${ip}`, IP_LIMIT, RATE_WINDOW_MS)
  if (!ipLimit.ok)
    return json({ error: 'rate limited' }, 429, { 'Retry-After': String(ipLimit.retryAfter) })

  // Resolve the project. The ingest key is globally unique, so it identifies the
  // project on its own — a key-only client sends no project id at all (simpler
  // than a Sentry DSN, which carries the project id in its path). When a client
  // DOES send a project id we still honor it and require the key to match it.
  const providedKey = request.headers?.get('x-bughq-key') ?? body.key ?? null
  const requestedProject = body.project ?? body.p ?? null
  let project = null
  if (requestedProject) {
    project = (await db.unsafe(
      'SELECT id, ingest_key, is_active FROM projects WHERE id = $1 LIMIT 1',
      [String(requestedProject)],
    ))?.[0] ?? null
  }
  else if (providedKey) {
    project = (await db.unsafe(
      'SELECT id, ingest_key, is_active FROM projects WHERE ingest_key = $1 LIMIT 1',
      [String(providedKey)],
    ))?.[0] ?? null
  }
  const auth = authorizeIngest(project, providedKey)
  if (!auth.ok)
    return json({ error: auth.error }, auth.status)

  // Canonical project id for everything downstream (rate limit, grouping,
  // inserts) — always the resolved row's id, never the raw request value.
  const projectId = String(project.id)

  // Per-project quota: the meaningful abuse dimension (a flood targets one
  // project's key). Keyed after auth so an invalid key can't consume a
  // project's budget.
  const projLimit = await rateLimit(`proj:${projectId}`, PROJECT_LIMIT, RATE_WINDOW_MS)
  if (!projLimit.ok)
    return json({ error: 'rate limited' }, 429, { 'Retry-After': String(projLimit.retryAfter) })

  const now = new Date().toISOString()
  const errorType = clip(String(body.type ?? body.error_type ?? 'Error'), 255)
  // Bound stored strings server-side: never trust the SDK's client-side caps.
  const message = clip(String(body.message), MAX_MESSAGE)
  const stack = body.stack ? clip(String(body.stack), MAX_STACK) : undefined
  // A client may force grouping with an explicit `fingerprint` array; otherwise
  // we derive one from type + normalized message + top stack frame.
  const fpOverride = Array.isArray(body.fingerprint) && body.fingerprint.length
    ? body.fingerprint.map((p: unknown) => String(p))
    : null
  const fp = fpOverride ? fingerprintFromParts(fpOverride) : fingerprint(errorType, message, stack)

  // Roll the occurrence into its Issue in ONE atomic statement.
  //
  // This used to be a SELECT followed by either an UPDATE that computed
  // `count = read + 1` in application code, or an INSERT with no ON CONFLICT.
  // Four defects fell out of that shape, and all four are fixed by making it
  // one statement:
  //
  //   - Lost increments. Read-then-write is not atomic, so concurrent events
  //     overwrote each other's count. Measured on live data: one issue stored 3
  //     against 21 real error_events rows, another 2 against 11 — and `count` is
  //     the number the dashboard, the alerts and the issue page all display.
  //   - Ignore never stuck. The UPDATE wrote the literal 'unresolved' on every
  //     repeat, so the next occurrence silently un-ignored an ignored issue.
  //     The CASE below reopens only what was RESOLVED — which is the regression
  //     the alert exists for — and leaves 'ignored' alone.
  //   - last_seen could move BACKWARDS, because the last write to COMMIT won
  //     rather than the one carrying the latest timestamp. That corrupts the
  //     ordering the issue list is sorted by (ORDER BY last_seen DESC), so a
  //     recurring error could fail to rise. GREATEST fixes it: the timestamps
  //     are fixed-width ISO-8601 UTC, so lexical order is chronological order.
  //   - Two concurrent FIRST sightings of one fingerprint raced the unique index
  //     (project_id, fingerprint). The loser threw, the request 500'd, and the
  //     event was lost outright — the error_events insert below is never
  //     reached. ON CONFLICT turns the loser into an update.
  //
  // `prev` reads the pre-upsert status in the same snapshot; once the CASE has
  // rewritten the row there is no other way to tell a regression from an
  // ordinary repeat. `xmax = 0` is the standard way to ask an upsert whether it
  // inserted or updated.
  const title = issueTitle(errorType, message)
  const where = culprit(stack)
  const rolled = (await db.unsafe(
    `WITH prev AS (
       SELECT status AS prev_status FROM issues
        WHERE project_id = $2 AND fingerprint = $3
     ), up AS (
       INSERT INTO issues (
         id, project_id, fingerprint, title, culprit, error_type, level,
         status, count, users_affected, first_seen, last_seen
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'unresolved', 1, 0, $8, $8)
       ON CONFLICT (project_id, fingerprint) DO UPDATE SET
         count      = COALESCE(issues.count, 0) + 1,
         last_seen  = GREATEST(issues.last_seen, EXCLUDED.last_seen),
         first_seen = COALESCE(issues.first_seen, EXCLUDED.first_seen),
         status     = CASE
                        WHEN issues.status IS NULL      THEN 'unresolved'
                        WHEN issues.status = 'resolved' THEN 'unresolved'
                        ELSE issues.status
                      END
       RETURNING id, count, (xmax = 0) AS inserted
     )
     SELECT up.id, up.count, up.inserted, (SELECT prev_status FROM prev) AS prev_status
       FROM up`,
    // title is a text column; culprit/error_type/level are varchar(255), so
    // those three stay capped or an oversized value aborts the insert.
    [randomId(), String(projectId), fp, title, col255(where), col255(errorType), col255(body.level ?? 'error'), now],
  ))?.[0]

  // A statement that cannot fail silently: without a row there is no issue id to
  // attach the event to, and attaching it to a fabricated one would corrupt the
  // grouping this whole endpoint exists to do.
  if (!rolled?.id)
    return json({ error: 'could not record issue' }, 500)

  const issueId = String(rolled.id)
  const isNewIssue = rolled.inserted === true
  // Only a RESOLVED issue coming back is a regression. An ignored one recurring
  // is expected — that is what ignoring it meant — and must not alert.
  const isRegression = !isNewIssue && String(rolled.prev_status ?? '') === 'resolved'

  // The two moments worth a human's attention. Fire-and-forget: mail and webhook
  // transports must never slow or break the ingest path. Gated by the per-project
  // throttle so a flood of unique errors cannot email-bomb.
  if ((isNewIssue || isRegression) && await allowAlert(String(projectId))) {
    const kind = isNewIssue ? 'new' : 'regression'
    dispatchAlerts(String(projectId), {
      id: issueId,
      title,
      culprit: where,
      level: body.level ?? 'error',
      environment: body.environment ?? null,
      count: Number(rolled.count ?? 1),
    }, kind).catch(err => console.error(`[alerts] ${kind} alert failed:`, err instanceof Error ? err.message : err))
  }

  await db.insertInto('error_events').values({
    id: randomId(),
    project_id: String(projectId),
    issue_id: issueId,
    message,
    stack: stack ?? null,
    // varchar(255) columns — cap so an oversized value can't abort the insert.
    error_type: col255(errorType),
    category: col255(categorize(errorType, message)),
    severity: col255(body.level ?? 'error'),
    fingerprint: fp,
    url: body.url ?? null,
    browser: col255(body.browser),
    os: col255(body.os),
    user_agent: request.headers?.get('user-agent') ?? null,
    framework: col255(body.framework),
    release: col255(body.release),
    environment: col255(body.environment ?? 'production'),
    user_context: body.user ? JSON.stringify(body.user) : null,
    metadata: buildMetadata(body),
    timestamp: now,
  }).execute()

  return json({ ok: true, issue: issueId }, 201)
}).skipCsrf() // public ingest: SDKs POST cross-origin with no CSRF cookie

// ---------------------------------------------------------------------------
// Issues API (dashboard)
// ---------------------------------------------------------------------------

route.get('/api/projects/{projectId}/issues', async (request: any) => {
  const projectId = request.params.projectId
  const user = await userFromRequest(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  const status = request.query?.status
  const cols = 'id, title, culprit, error_type, level, status, count, first_seen, last_seen'
  const issues = status
    ? await db.unsafe(
        `SELECT ${cols} FROM issues WHERE project_id = $1 AND status = $2 ORDER BY last_seen DESC LIMIT 100`,
        [projectId, status],
      )
    : await db.unsafe(
        `SELECT ${cols} FROM issues WHERE project_id = $1 ORDER BY last_seen DESC LIMIT 100`,
        [projectId],
      )
  return json({ issues: issues ?? [] })
})

route.get('/api/issues/{issueId}', async (request: any) => {
  const issueId = request.params.issueId
  const user = await userFromRequest(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  if (!(await ownsIssue(user, issueId)))
    return json({ error: 'not found' }, 404)
  const issue = (await db.unsafe('SELECT * FROM issues WHERE id = $1 LIMIT 1', [issueId]))?.[0]
  if (!issue)
    return json({ error: 'not found' }, 404)
  const events = await db.unsafe(
    'SELECT * FROM error_events WHERE issue_id = $1 ORDER BY timestamp DESC LIMIT 25',
    [issueId],
  )
  return json({ issue, events: events ?? [] })
})

/**
 * The only statuses an issue may hold. Both the JSON endpoint and the form
 * endpoint validate against this, and the ingest's regression branch depends on
 * 'resolved' being spelled exactly this way.
 */
const ISSUE_STATUSES = new Set(['unresolved', 'resolved', 'ignored'])

/**
 * How long each snooze preset lasts. Server-side so the duration cannot be
 * chosen by the caller — see the note at the snooze branch below.
 */
const SNOOZE_PRESETS = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
} as const

route.post('/api/issues/{issueId}/resolve', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const issueId = request.params.issueId
  const user = await userFromRequest(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  if (!(await ownsIssue(user, issueId)))
    return json({ error: 'not found' }, 404)
  // Validated against the same whitelist as the form endpoint below. This one
  // wrote request.jsonBody.status straight into the column: any string at all
  // became an issue's status, and since every filter tab queries `status = ...`
  // (dashboard.stx) a typo or a probe silently removed the issue from
  // Unresolved, Resolved AND the ingest's regression check, which only reopens
  // rows reading exactly 'resolved'. Unreachable from any tab, and no longer
  // able to alert.
  // Snooze branch. `{ snooze: '1h' }` hides the issue until then; `{ snooze:
  // null }` wakes it now. Snooze is a COLUMN, not a status — a snoozed issue is
  // still unresolved, so nothing has to remember what to restore it to, and
  // expiry is a WHERE predicate rather than a job that could die and hide an
  // issue forever.
  if ('snooze' in (request.jsonBody ?? {})) {
    const key = request.jsonBody.snooze
    if (key === null) {
      await db.unsafe('UPDATE issues SET snoozed_until = NULL WHERE id = $1', [issueId])
      return json({ ok: true, snoozed_until: null })
    }
    const ms = SNOOZE_PRESETS[key as keyof typeof SNOOZE_PRESETS]
    if (!ms)
      return json({ error: 'invalid snooze duration' }, 400)
    // Computed here rather than accepting a client timestamp: a caller could
    // otherwise snooze an issue until the year 3000 and remove it from every
    // tab permanently.
    const until = new Date(Date.now() + ms).toISOString()
    // Snoozing implies the issue is open. Doing this in one statement keeps a
    // snoozed row from ever being simultaneously resolved or ignored, which is
    // what lets the Snoozed and Ignored tabs stay disjoint without a constraint.
    await db.unsafe(
      `UPDATE issues SET snoozed_until = $1, status = 'unresolved' WHERE id = $2`,
      [until, issueId],
    )
    return json({ ok: true, snoozed_until: until })
  }

  const status = request.jsonBody?.status ?? 'resolved'
  if (!ISSUE_STATUSES.has(status))
    return json({ error: 'invalid status' }, 400)
  // Any status change clears the snooze. Without this a resolved issue could
  // still carry a future snoozed_until and reappear on the Snoozed tab, which
  // is meant to hold open work only.
  await db.unsafe('UPDATE issues SET status = $1, snoozed_until = NULL WHERE id = $2', [status, issueId])
  return json({ ok: true, status })
}).skipCsrf()

// Form-friendly status change used by the issue detail page's Resolve/Ignore/
// Reopen buttons. Plain HTML form POST (no JS) -> 302 back to the issue, so the
// page reflects the new status on reload.
route.post('/issue/{issueId}/status', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const issueId = request.params.issueId
  const to = request.query?.to ?? request.jsonBody?.to ?? 'resolved'
  if (!ISSUE_STATUSES.has(to))
    return json({ error: 'invalid status' }, 400)
  const user = await userFromRequest(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  if (!(await ownsIssue(user, issueId)))
    return json({ error: 'not found' }, 404)
  await db.unsafe('UPDATE issues SET status = $1 WHERE id = $2', [to, issueId])
  return new Response(null, {
    status: 302,
    headers: { Location: `/issue/${encodeURIComponent(issueId)}`, ...CORS },
  })
}).skipCsrf() // plain HTML form POST from the issue page (no CSRF cookie)

// ---------------------------------------------------------------------------
// SDK + health
// ---------------------------------------------------------------------------

// Registered twice, and both are load-bearing.
//
// The public origin routes `/api/*` to this server and EVERYTHING else to the
// web app, so a bare GET like `/sdk.js` never arrives here in production — it
// reaches the page handler, finds no page, and answers the 404 HTML document.
// Verified against bughq.org: `GET /sdk.js` returned `text/html` where a
// customer's browser expected JavaScript, so every snippet this app generates
// for a `javascript` project has been loading an error page. `/health` and
// `/join/{token}` were unreachable the same way.
//
// POSTs are unaffected, which is why ingest itself was fine: `POST /errors`
// answers correctly on the public origin today.
//
// The bare paths stay for direct access to this server (local dev, the health
// probe on the box, anything talking to :3108) — they cost nothing and removing
// them would break those.
function sdkScript(request: any): Response {
  // The PUBLIC origin, not the request's. Behind the reverse proxy `request.url`
  // is the loopback address the proxy dialled, so this baked
  // `fetch('http://127.0.0.1:3023/errors')` into the script served to real
  // browsers — verified on bughq.org, which is a URL a customer's machine can
  // only ever fail to reach. ingestUrl() is APP_URL in production and the local
  // ingest port in dev; the request origin stays as the last resort for a
  // deployment that configures neither.
  const origin = ingestUrl() || new URL(request.url).origin
  // eslint-disable pickier/no-unused-vars -- the string below is the browser SDK source (a template literal), not real declarations; pickier's token scan misreads its `var`/`function` tokens.
  const script = `(function(){
  var s=document.currentScript,project=s&&s.getAttribute('data-project'),key=s&&s.getAttribute('data-key');
  if(!key)return;
  var release=s&&s.getAttribute('data-release'),env=s&&s.getAttribute('data-environment'),fw=s&&s.getAttribute('data-framework');
  function report(err,extra){try{
    var e=err&&err.error?err.error:err;
    fetch('${origin}/errors',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-BugHQ-Key':key},
      body:JSON.stringify({project:project||undefined,type:(e&&e.name)||'Error',message:(e&&e.message)||String(e),
        stack:e&&e.stack,url:location.href,release:release||undefined,environment:env||undefined,
        framework:fw||'script',timestamp:new Date().toISOString(),
        sdk:{name:'bughq.js.loader',version:'0.2.0'},extra:extra||null})});
  }catch(_){}}
  window.addEventListener('error',function(ev){report(ev)});
  window.addEventListener('unhandledrejection',function(ev){report(ev.reason||ev)});
  window.bughq={capture:function(err,extra){report(err,extra)}};
})();`
  return new Response(script, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...CORS },
  })
}

route.get('/sdk.js', sdkScript)
route.get('/api/sdk.js', sdkScript)

// Same reachability split as /sdk.js above: /api/health is the one an uptime
// check on the public origin can actually see.
route.get('/health', () => response.json({ status: 'ok', app: 'bughq' }))
route.get('/api/health', () => response.json({ status: 'ok', app: 'bughq' }))
