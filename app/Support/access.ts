import { Auth } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { authorizeRead, looksLikeReadKey, shouldRecordUse } from './read-key'

/**
 * Who is calling, and may they touch this project.
 *
 * The same three checks routes/projects.ts and routes/errors.ts each carry a
 * copy of; new route files import them from here instead of adding a fourth.
 */

/**
 * The signed-in user, from a bearer token (API callers) or the HttpOnly
 * `auth-token` cookie the dashboard sends.
 */
export async function currentUser(request: any): Promise<any | null> {
  const authHeader = request.headers?.get?.('authorization') ?? ''
  let token = request.bearerToken?.() ?? authHeader.replace(/^Bearer\s+/i, '')
  // An upload token is not a session; never try it as one. Nor is a read key
  // (app/Support/read-key.ts), which authorises one project rather than a
  // person and is resolved by projectReadAccess below.
  if (token && (token.startsWith('bughq_up_') || looksLikeReadKey(token)))
    token = ''
  if (!token) {
    const cookie = request.headers?.get?.('cookie') ?? ''
    const m = cookie.match(/(?:^|;)\s*auth-token=([^;]+)/)
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

/** Owner-only: credentials, deletion, members. */
export async function ownsProject(user: any, projectId: string): Promise<boolean> {
  const row = (await db.unsafe(
    'SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [projectId, Number(user.id)],
  ))?.[0]
  return !!row
}

/** Owner or invited member: reading and triage. */
export async function canAccessProject(user: any, projectId: string): Promise<boolean> {
  const email = String(user?.email ?? '').trim().toLowerCase()
  const row = (await db.unsafe(
    `SELECT 1 FROM projects p
     WHERE p.id = $1 AND (
       p.owner_id = $2
       OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND lower(m.email) = $3)
     ) LIMIT 1`,
    [projectId, Number(user.id), email],
  ))?.[0]
  return !!row
}

export type ProjectReadAccess =
  | { ok: true, as: 'user', user: any }
  | { ok: true, as: 'key' }
  | { ok: false, status: 401 | 403 | 404, error: string }

/** The bearer a request presents, before anything decides what kind it is. */
function bearerFrom(request: any): string {
  const authHeader = request.headers?.get?.('authorization') ?? ''
  const header = request.bearerToken?.() ?? authHeader.replace(/^Bearer\s+/i, '')
  if (header)
    return header
  const cookie = request.headers?.get?.('cookie') ?? ''
  const m = cookie.match(/(?:^|;)\s*auth-token=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

/**
 * Who may read this project: the person signed in, or a key issued for it.
 *
 * Only the two read endpoints named on #19 call this — the issue list and a
 * single issue. Autofix and the debug-file endpoints keep asking for a user,
 * so a read key refuses them rather than quietly reaching further than the
 * credential was meant to.
 *
 * A key belonging to a different project answers 404 rather than 403, matching
 * canAccessProject: a caller who cannot read a project should not learn it
 * exists.
 */
export async function projectReadAccess(request: any, projectId: string): Promise<ProjectReadAccess> {
  const presented = bearerFrom(request)

  if (looksLikeReadKey(presented)) {
    // db.unsafe answers an untyped row, so the columns are narrowed here rather
    // than asserted: authorizeRead decides who may read a project and should be
    // reading values it can see the shape of.
    const found = (await db.unsafe(
      'SELECT id, read_key, read_key_last_used_at, is_active FROM projects WHERE id = $1 LIMIT 1',
      [String(projectId)],
    ))?.[0]
    const row = found
      ? {
          id: String(found.id),
          read_key: found.read_key == null ? null : String(found.read_key),
          read_key_last_used_at: found.read_key_last_used_at == null ? null : String(found.read_key_last_used_at),
          is_active: found.is_active as boolean | number | null,
        }
      : null
    const verdict = authorizeRead(row, presented)
    if (!verdict.ok)
      return verdict.status === 401 ? { ok: false, status: 404, error: 'not found' } : verdict
    if (row)
      await recordReadKeyUse(row)
    return { ok: true, as: 'key' }
  }

  const user = await currentUser(request)
  if (!user)
    return { ok: false, status: 401, error: 'unauthorized' }
  if (!(await canAccessProject(user, projectId)))
    return { ok: false, status: 404, error: 'not found' }
  return { ok: true, as: 'user', user }
}

/** Stamp the key as used, at most once a minute — see LAST_USED_RESOLUTION_MS. */
async function recordReadKeyUse(project: { id: string, read_key_last_used_at?: string | null }): Promise<void> {
  const now = new Date()
  if (!shouldRecordUse(project.read_key_last_used_at, now))
    return
  // Never let the stamp fail a read: it aids revoking a key, it does not
  // authorise one.
  await db.unsafe('UPDATE projects SET read_key_last_used_at = $1 WHERE id = $2', [now.toISOString(), String(project.id)]).catch(() => {})
}
