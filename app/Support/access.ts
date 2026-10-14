import { Auth } from '@stacksjs/auth'
import { db } from '@stacksjs/database'

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
  // An upload token is not a session; never try it as one.
  if (token && token.startsWith('bughq_up_'))
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
