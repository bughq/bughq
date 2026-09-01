/**
 * bughq — project management API (per-user).
 *
 * Projects are owned by the authenticated user (`owner_id`). These endpoints
 * back the create-app screen and the dashboard's project switcher. Auth is the
 * bearer token (via the `auth` middleware); the client sends it from
 * localStorage. Each new project gets its own public `ingest_key`.
 */

import { Auth } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { route } from '@stacksjs/router'
import { type ChannelType, sendTestAlert, validateWebhook } from '../app/Errors/channels'
import type { InviteDelivery } from '../app/Invites/invites'
import { FREE_PROJECTS } from '../app/Billing/plans'
import { isPro } from '../app/Billing/pro'
import { deliverInvite, joinUrl, newInviteToken } from '../app/Invites/invites'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

const CHANNEL_TYPES = new Set<ChannelType>(['slack', 'discord'])

/**
 * How long the invite endpoint waits for the mail transport before answering
 * anyway. Long enough for a healthy SMTP handshake, short enough that a wedged
 * one does not hold the owner's browser open. Losing the race is not an error:
 * the delivery result is written to the invite row regardless, so the Members
 * list corrects itself on the next load.
 */
const INVITE_DELIVERY_TIMEOUT_MS = 8000

/** True when `user` owns the project. Channels inherit the project's owner. */
async function ownsProject(user: any, projectId: string): Promise<boolean> {
  const row = (await db.unsafe(
    'SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [projectId, Number(user.id)],
  ))?.[0]
  return !!row
}

/**
 * Never return a stored webhook secret to the browser. Show enough to tell two
 * channels apart (host + a short tail) and nothing that could be replayed.
 */
function maskWebhook(url: string): string {
  try {
    const u = new URL(url)
    const tail = url.slice(-4)
    return `${u.host}/…${tail}`
  }
  catch {
    return '…'
  }
}

function newChannelId(): string {
  return `ch_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

// Resolve the authenticated user from the bearer token. The `auth` middleware
// alias does not reliably populate `request.user()` on route handlers (see
// CreateCheckoutAction), so we read the token and resolve it directly.
async function currentUser(request: any): Promise<any | null> {
  const authHeader = request.headers?.get?.('authorization') ?? ''
  const bearer = request.bearerToken?.() ?? authHeader.replace(/^Bearer\s+/i, '')
  if (!bearer)
    return null
  try {
    return await Auth.getUserFromToken(bearer)
  }
  catch {
    return null
  }
}

// Resolve the user from the `bughq_token` cookie (browser navigations like the
// /join link carry no bearer header, only the cookie login mirrors).
async function userFromCookie(request: any): Promise<any | null> {
  const cookie = request.headers?.get?.('cookie') ?? ''
  const m = cookie.match(/(?:^|;)\s*bughq_token=([^;]+)/)
  if (!m)
    return null
  try {
    return await Auth.getUserFromToken(decodeURIComponent(m[1]))
  }
  catch {
    return null
  }
}

/** A short, readable, unique project id: slug of the name + a random suffix. */
function newProjectId(name: string): string {
  const slug = (name || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'app'
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  return `${slug}-${rand}`
}

/**
 * A public, revocable ingest key (not a secret; ships in client code). The
 * `bughq_` prefix makes it recognizable as a bughq key at a glance (Stripe/
 * GitHub style) and greppable in code and logs.
 */
function newIngestKey(): string {
  return `bughq_${(globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '')}`
}

function newMemberId(): string {
  return `mem_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

/** The authenticated user's email, lowercased for case-insensitive matching. */
function userEmail(user: any): string {
  return String(user?.email ?? '').trim().toLowerCase()
}

/**
 * True when `user` can ACCESS the project: either its owner, or an invited
 * member (matched by email). Read/triage endpoints use this; administrative
 * endpoints (keys, delete, members) use the owner-only `ownsProject`.
 */
async function canAccessProject(user: any, projectId: string): Promise<boolean> {
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

// List the projects the current user can access: the ones they own plus any
// they've been invited to as a member (matched by email).
route.get('/api/projects', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const rows = await db.unsafe(
    `SELECT DISTINCT p.id, p.name, p.platform, p.ingest_key, p.is_active, p.created_at,
            (p.owner_id = $1) AS is_owner
     FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND lower(m.email) = $2
     WHERE p.owner_id = $1 OR m.email IS NOT NULL
     ORDER BY p.created_at DESC NULLS LAST, p.id`,
    [Number(user.id), userEmail(user)],
  )
  return json({ projects: rows ?? [] })
})

// Create a project owned by the current user.
route.post('/api/projects', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)

  const body = request.jsonBody ?? {}
  const name = String(body.name ?? '').trim()
  if (!name)
    return json({ error: 'Project name is required.' }, 400)
  if (name.length > 255)
    return json({ error: 'Project name is too long.' }, 400)

  // Checked on CREATE, not on access, so an account that already has several
  // keeps every one of them and simply cannot add another. The allowance itself
  // lives in app/Billing/plans.ts; do not restate the number here, because a
  // comment is exactly the copy that goes stale when it changes.
  //
  // Counts every project the user owns, archived ones included: archiving does
  // not free a slot.
  //
  // Fails OPEN: isPro() returns true when billing is unconfigured (self-hosted)
  // or when the lookup itself errors. A billing hiccup must never stop someone
  // creating a project they are entitled to.
  if (!(await isPro(Number(user.id)))) {
    const owned = Number((await db.unsafe(
      'SELECT COUNT(*) AS n FROM projects WHERE owner_id = $1',
      [Number(user.id)],
    ))?.[0]?.n ?? 0)
    if (owned >= FREE_PROJECTS) {
      return json({
        error: `Free includes ${FREE_PROJECTS} project${FREE_PROJECTS === 1 ? '' : 's'}. Upgrade to Pro for unlimited projects.`,
        upgrade: '/pricing',
      }, 402)
    }
  }

  const platform = String(body.platform ?? 'javascript').slice(0, 60)
  const id = newProjectId(name)
  const ingestKey = newIngestKey()

  await db.insertInto('projects').values({
    id,
    name,
    platform,
    ingest_key: ingestKey,
    owner_id: Number(user.id),
    is_active: true,
  }).execute()

  return json({ project: { id, name, platform, ingest_key: ingestKey } }, 201)
}).skipCsrf()

// ---------------------------------------------------------------------------
// Project administration (owner-only): key rotation, deletion, members.
// ---------------------------------------------------------------------------

// Rotate a project's ingest key. The old key stops working immediately (the
// ingest checks strict equality), so any SDK still sending the old key will get
// 401 until its config is updated — that's the point of a rotate.
route.post('/api/projects/{projectId}/rotate-key', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const key = newIngestKey()
  await db.unsafe('UPDATE projects SET ingest_key = $1, updated_at = NOW() WHERE id = $2', [key, projectId])
  return json({ ingest_key: key })
}).skipCsrf()

// Delete a project and everything under it. Owner-only. Removes children first
// to satisfy the foreign keys (events -> issues -> project; channels/members ->
// project), then the project row.
route.delete('/api/projects/{projectId}', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  await db.unsafe('DELETE FROM error_events WHERE project_id = $1', [projectId])
  await db.unsafe('DELETE FROM autofix_runs WHERE project_id = $1', [projectId])
  await db.unsafe('DELETE FROM issues WHERE project_id = $1', [projectId])
  await db.unsafe('DELETE FROM alert_channels WHERE project_id = $1', [projectId])
  await db.unsafe('DELETE FROM project_members WHERE project_id = $1', [projectId])
  await db.unsafe('DELETE FROM project_invites WHERE project_id = $1', [projectId])
  await db.unsafe('DELETE FROM projects WHERE id = $1', [projectId])
  return json({ ok: true })
}).skipCsrf()

// Archive / unarchive a project (owner-only). Archiving flips is_active off, so
// the ingest endpoint rejects new events (see app/Errors/ingest.ts) and alerts
// pause — but every issue, event, and member is kept. Fully reversible: pass
// { archived: false } to bring it back. Body defaults to archiving.
route.post('/api/projects/{projectId}/archive', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const archived = (request.jsonBody ?? {}).archived !== false
  await db.unsafe('UPDATE projects SET is_active = $1, updated_at = NOW() WHERE id = $2', [!archived, projectId])
  return json({ ok: true, is_active: !archived })
}).skipCsrf()

// List a project's people (owner-only): active members plus pending invites,
// unified with a `kind` so the UI can badge them. The owner is not a row here;
// the caller renders it from the project's owner_id.
route.get('/api/projects/{projectId}/members', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const members = (await db.unsafe(
    `SELECT m.id, m.email, m.role, m.created_at FROM project_members m
     WHERE m.project_id = $1 ORDER BY m.created_at ASC NULLS LAST, m.email`,
    [projectId],
  )) ?? []
  const invites = (await db.unsafe(
    `SELECT i.id, i.email, i.created_at, i.delivery_status, i.delivery_error, (u.id IS NOT NULL) AS registered
     FROM project_invites i LEFT JOIN users u ON lower(u.email) = lower(i.email)
     WHERE i.project_id = $1 ORDER BY i.created_at ASC NULLS LAST, i.email`,
    [projectId],
  )) ?? []
  return json({
    members: members.map((m: any) => ({ id: m.id, email: m.email, role: m.role, kind: 'member' })),
    invites: invites.map((i: any) => ({
      id: i.id,
      email: i.email,
      kind: 'invite',
      registered: !!i.registered,
      // Whether the join link actually reached them. Without this the owner
      // cannot tell a teammate who has not got round to accepting from one who
      // was never emailed at all.
      delivery_status: i.delivery_status ?? 'pending',
      delivery_error: i.delivery_error ?? null,
    })),
  })
}).skipCsrf()

// Invite a teammate by email (owner-only). Creates a pending invite with a
// secret token and emails a join link; the recipient signs up / logs in and
// accepts from a banner. Idempotent per (project, email). Returns the join URL
// too, so the owner can share it directly when email isn't delivered (local
// dev uses the `log` mail driver).
route.post('/api/projects/{projectId}/members', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const email = String((request.jsonBody ?? {}).email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: 'Enter a valid email address.' }, 400)
  if (email.length > 255)
    return json({ error: 'Email is too long.' }, 400)

  const project = (await db.unsafe('SELECT name, owner_id FROM projects WHERE id = $1 LIMIT 1', [projectId]))?.[0]
  // Inviting the owner is a no-op — they already have full access.
  if (project) {
    const ownerRow = (await db.unsafe('SELECT lower(email) AS email FROM users WHERE id = $1 LIMIT 1', [Number(project.owner_id)]))?.[0]
    if (ownerRow && ownerRow.email === email)
      return json({ error: 'That is the owner — they already have access.' }, 400)
  }
  const already = (await db.unsafe(
    'SELECT id FROM project_members WHERE project_id = $1 AND lower(email) = $2 LIMIT 1',
    [projectId, email],
  ))?.[0]
  if (already)
    return json({ error: 'That person is already a member.' }, 409)
  const pending = (await db.unsafe(
    'SELECT id, token FROM project_invites WHERE project_id = $1 AND lower(email) = $2 LIMIT 1',
    [projectId, email],
  ))?.[0]

  // Re-inviting reuses the existing token and row (idempotent), which is also
  // what makes this endpoint the Resend button — the UI posts the same address
  // again and the recipient gets another copy of the same link.
  const token = pending?.token ?? newInviteToken()
  let inviteId = pending?.id
  if (!pending) {
    // Inviting is Pro. Deliberately inside this branch: resending an invite that
    // already exists stays available, so a Free owner who invited someone before
    // upgrading — or before this gate existed — can still get the link to them.
    // Existing members are untouched; nothing here revokes access.
    if (!(await isPro(Number(user.id)))) {
      return json({
        error: 'Inviting teammates is part of Pro.',
        upgrade: '/pricing',
      }, 402)
    }
    inviteId = newMemberId()
    await db.unsafe(
      'INSERT INTO project_invites (id, project_id, email, token, invited_by) VALUES ($1, $2, $3, $4, $5)',
      [inviteId, projectId, email, token, Number(user.id)],
    )
  }
  else {
    // A resend is a fresh attempt, so clear the previous verdict rather than
    // leaving a stale "failed" next to a link that has just been sent again.
    await db.unsafe(
      `UPDATE project_invites SET delivery_status = 'pending', delivery_error = NULL WHERE id = $1`,
      [inviteId],
    )
  }
  const projectName = project?.name || projectId

  // Wait for the transport, but not indefinitely. Telling the owner whether the
  // email actually left is the whole point, and that answer only exists once the
  // send returns — but a wedged SMTP connection must not hold the request open
  // for its socket timeout. `deliverInvite` records the outcome on the row
  // itself, so when the race is lost the write still lands and the Members list
  // shows the real state on the next load; the response just says 'pending'.
  const delivery = await Promise.race([
    deliverInvite({ inviteId: String(inviteId), email, projectName, token, inviterName: user.name ?? undefined }),
    new Promise<InviteDelivery>(resolve => setTimeout(() => resolve({ status: 'pending', error: null }), INVITE_DELIVERY_TIMEOUT_MS)),
  ])

  return json({
    invite: {
      email,
      kind: 'invite',
      join_url: joinUrl(token),
      resent: !!pending,
      delivery_status: delivery.status,
      delivery_error: delivery.error,
    },
  }, 201)
}).skipCsrf()

// Remove a person (owner-only): an active member or a pending invite. Ids are
// looked up in both tables, so one endpoint handles either. Access/offer is
// revoked immediately.
route.delete('/api/projects/{projectId}/members/{memberId}', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const { projectId, memberId } = request.params
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const m = (await db.unsafe('DELETE FROM project_members WHERE id = $1 AND project_id = $2 RETURNING id', [memberId, projectId])) ?? []
  const i = m.length ? [] : ((await db.unsafe('DELETE FROM project_invites WHERE id = $1 AND project_id = $2 RETURNING id', [memberId, projectId])) ?? [])
  if (!m.length && !i.length)
    return json({ error: 'not found' }, 404)
  return json({ ok: true })
}).skipCsrf()

// Accept a pending invite (the banner's Join button). The signed-in user's
// email must match the invite's — an invite is addressed to a specific person,
// so a forwarded link can't be claimed by someone else. Moves the invite into
// active membership.
route.post('/api/invites/accept', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const token = String((request.jsonBody ?? {}).token ?? '').trim()
  if (!token)
    return json({ error: 'missing token' }, 400)

  const invite = (await db.unsafe(
    'SELECT id, project_id, email FROM project_invites WHERE token = $1 LIMIT 1',
    [token],
  ))?.[0]
  if (!invite)
    return json({ error: 'This invite is no longer valid.' }, 404)
  if (String(invite.email).toLowerCase() !== userEmail(user))
    return json({ error: `This invite was sent to ${invite.email}. Sign in with that email to accept.` }, 403)

  // Idempotent: create the membership only if it isn't already there.
  const exists = (await db.unsafe(
    'SELECT id FROM project_members WHERE project_id = $1 AND lower(email) = $2 LIMIT 1',
    [invite.project_id, userEmail(user)],
  ))?.[0]
  if (!exists) {
    await db.unsafe(
      'INSERT INTO project_members (id, project_id, email, role) VALUES ($1, $2, $3, $4)',
      [newMemberId(), invite.project_id, userEmail(user), 'member'],
    )
  }
  await db.unsafe('DELETE FROM project_invites WHERE id = $1', [invite.id])
  return json({ ok: true, project: invite.project_id })
}).skipCsrf()

// The join link from the invite email. Resolves the invite, then routes the
// visitor: signed-in users go to the dashboard (where the banner offers Join);
// signed-out users go to register with the email prefilled so they sign up as
// the invited person. A short-lived cookie carries the token through auth.
// Registered under /api/ as well, and that alias is the one that works in
// production: the public origin routes /api/* here and everything else to the
// web app, so a bare GET /join/<token> answered the 404 page. Every invite link
// this app has ever handed out — copied from settings or emailed — pointed at a
// path that could not resolve on the public origin. See the note in
// routes/errors.ts for the same split on /sdk.js and /health.
async function joinHandler(request: any): Promise<Response> {
  const token = String(request.params.token ?? '')
  const invite = (await db.unsafe(
    'SELECT email FROM project_invites WHERE token = $1 LIMIT 1',
    [token],
  ))?.[0]
  // Mark Secure when the request arrived over https (prod behind TLS) so the
  // cookie never rides a plaintext request; omitted on http so local dev works.
  const proto = request.headers?.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '')
  const secure = proto === 'https' ? '; secure' : ''
  const cookie = `bughq_invite=${encodeURIComponent(token)}; path=/; max-age=604800; samesite=lax${secure}`
  if (!invite) {
    // Unknown/expired token: send them to the dashboard; the banner just won't show.
    return new Response(null, { status: 302, headers: { Location: '/dashboard' } })
  }
  const user = await userFromCookie(request)
  const location = user
    ? '/dashboard'
    : `/register?email=${encodeURIComponent(invite.email)}&invite=${encodeURIComponent(token)}`
  return new Response(null, { status: 302, headers: { Location: location, 'Set-Cookie': cookie } })
}

route.get('/join/{token}', joinHandler)
route.get('/api/join/{token}', joinHandler)

// ---------------------------------------------------------------------------
// Alert channels (Slack / Discord webhooks)
//
// All endpoints are owner-scoped: a channel is only reachable through the
// project it belongs to, and only by that project's owner. The stored
// webhook_url is a provider secret, so it is validated on write (SSRF host
// allowlist, see channels.ts) and never echoed back — the list returns a mask.
// ---------------------------------------------------------------------------

// List a project's channels (secrets masked).
route.get('/api/projects/{projectId}/channels', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const rows = (await db.unsafe(
    `SELECT id, type, label, webhook_url, enabled, created_at
     FROM alert_channels WHERE project_id = $1 ORDER BY created_at DESC NULLS LAST, id`,
    [projectId],
  )) ?? []
  const channels = rows.map((r: any) => ({
    id: r.id,
    type: r.type,
    label: r.label,
    enabled: !!r.enabled,
    webhook_mask: maskWebhook(String(r.webhook_url)),
    created_at: r.created_at,
  }))
  return json({ channels })
})

// Add a channel. Validates type + webhook host before storing.
route.post('/api/projects/{projectId}/channels', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const body = request.jsonBody ?? {}
  const type = String(body.type ?? '').toLowerCase() as ChannelType
  if (!CHANNEL_TYPES.has(type))
    return json({ error: 'Channel type must be slack or discord.' }, 400)
  const webhookUrl = String(body.webhook_url ?? '').trim()
  const valid = validateWebhook(type, webhookUrl)
  if (!valid.ok)
    return json({ error: valid.error }, 400)
  const label = String(body.label ?? '').trim().slice(0, 255) || null

  const id = newChannelId()
  await db.insertInto('alert_channels').values({
    id,
    project_id: projectId,
    type,
    label,
    webhook_url: webhookUrl,
    enabled: true,
  }).execute()

  return json({ channel: { id, type, label, enabled: true, webhook_mask: maskWebhook(webhookUrl) } }, 201)
}).skipCsrf()

// Toggle a channel on/off.
route.patch('/api/projects/{projectId}/channels/{channelId}', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const { projectId, channelId } = request.params
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const enabled = !!(request.jsonBody ?? {}).enabled
  const updated = (await db.unsafe(
    'UPDATE alert_channels SET enabled = $1, updated_at = NOW() WHERE id = $2 AND project_id = $3 RETURNING id',
    [enabled, channelId, projectId],
  )) ?? []
  if (!updated.length)
    return json({ error: 'not found' }, 404)
  return json({ ok: true, enabled })
}).skipCsrf()

// Delete a channel.
route.delete('/api/projects/{projectId}/channels/{channelId}', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const { projectId, channelId } = request.params
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const deleted = (await db.unsafe(
    'DELETE FROM alert_channels WHERE id = $1 AND project_id = $2 RETURNING id',
    [channelId, projectId],
  )) ?? []
  if (!deleted.length)
    return json({ error: 'not found' }, 404)
  return json({ ok: true })
}).skipCsrf()

// Send a test message to a stored channel so the owner can confirm delivery.
route.post('/api/projects/{projectId}/channels/{channelId}/test', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const { projectId, channelId } = request.params
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)

  const row = (await db.unsafe(
    `SELECT c.type, c.webhook_url, p.name AS project_name
     FROM alert_channels c JOIN projects p ON p.id = c.project_id
     WHERE c.id = $1 AND c.project_id = $2 LIMIT 1`,
    [channelId, projectId],
  ))?.[0]
  if (!row)
    return json({ error: 'not found' }, 404)

  const ok = await sendTestAlert(String(row.type) as ChannelType, String(row.webhook_url), String(row.project_name || projectId))
  if (!ok)
    return json({ error: 'The provider rejected the test message. Double-check the webhook URL.' }, 502)
  return json({ ok: true })
}).skipCsrf()
