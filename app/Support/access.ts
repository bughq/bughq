import { Auth, findToken } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { PROJECT_SCOPES, projectForToken } from './project-tokens'

/**
 * Who is calling, and may they touch this project.
 *
 * The same three checks routes/projects.ts and routes/errors.ts each carry a
 * copy of; new route files import them from here instead of adding a fourth.
 */

/**
 * What an API token may be allowed to do.
 *
 * API tokens are Stacks personal access tokens (`createToken` in
 * @stacksjs/auth): hashed at rest, named, scoped, expiring and revocable. A
 * person creates one under their account and it acts as them, within its
 * scopes, on every project they can access. The app adds nothing to that but
 * the two scope names below.
 */
export const TOKEN_SCOPES = {
  /** Read a project's issues: the issue list and a single issue. */
  read: 'issues:read',
  /** Change an issue's status: resolve, ignore, reopen. */
  triage: 'issues:triage',
} as const

export type TokenScope = typeof TOKEN_SCOPES[keyof typeof TOKEN_SCOPES]

/** The scopes somebody may ask for when creating an API token. */
export const GRANTABLE_SCOPES: readonly TokenScope[] = [TOKEN_SCOPES.read, TOKEN_SCOPES.triage]

/** What a sign-in is issued, and what an API token must never carry. */
const FULL_ACCESS = '*'

/**
 * Whether these scopes are a full session rather than an API token.
 *
 * Every sign-in is issued `*` (config.auth.defaultAbilities), and an API
 * token is created with named scopes only, so `*` is what separates "this is
 * the person" from "this may do one thing on their behalf". The framework
 * draws the same line for its own administrator checks.
 */
export function isFullSession(scopes: readonly string[]): boolean {
  return scopes.includes(FULL_ACCESS)
}

/** Whether a token's scopes allow `scope`: by name, or by being a session. */
export function scopesAllow(scopes: readonly string[], scope: TokenScope): boolean {
  return isFullSession(scopes) || scopes.includes(scope)
}

/** The user a token belongs to and the scopes it carries, or null. */
async function tokenHolder(token: string): Promise<{ user: any, scopes: readonly string[] } | null> {
  if (!token)
    return null
  try {
    // `findToken` is the native lookup: it answers only for a live token (not
    // revoked, not expired, not issued before the last password change).
    const access = await findToken(token)
    // A person's token only. A project's read key or upload token is a
    // framework token too, owned by the project's principal rather than a
    // user (app/Support/project-tokens.ts), and it is nobody's session.
    if (!access || (access.subjectType ?? 'users') !== 'users')
      return null
    const user = await Auth.getUserFromToken(token)
    return user ? { user, scopes: access.scopes } : null
  }
  catch {
    return null
  }
}

/**
 * The person signed in behind this token, and only a full session.
 *
 * This is the one place a token becomes "the user" for everything a signed-in
 * person can do: the dashboard, settings, billing, deleting a project. An API
 * token is refused here, so a token created to resolve issues cannot be put in
 * an `auth-token` cookie or a bearer header and used as its owner. Routes and
 * views call this rather than `Auth.getUserFromToken`, which answers for any
 * valid token whatever its scopes (tests/unit/api-tokens.test.ts holds that).
 */
export async function sessionUser(token: string | null | undefined): Promise<any | null> {
  const holder = await tokenHolder(String(token ?? ''))
  return holder && isFullSession(holder.scopes) ? holder.user : null
}

/**
 * The person a token acts for when the request needs `scope`: a full session,
 * or an API token that names the scope.
 */
export async function userWithScope(token: string | null | undefined, scope: TokenScope): Promise<any | null> {
  const holder = await tokenHolder(String(token ?? ''))
  return holder && scopesAllow(holder.scopes, scope) ? holder.user : null
}

/**
 * The signed-in user, from a bearer token or the HttpOnly `auth-token` cookie
 * the dashboard sends. A full session only: see `sessionUser`.
 */
export async function currentUser(request: any): Promise<any | null> {
  return sessionUser(bearerFrom(request))
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
 * Who may read this project: the person signed in, an API token of theirs
 * that may read issues, or a read key issued for the project.
 *
 * Only the two read endpoints call this, the issue list and a single issue.
 * Autofix and the debug-file endpoints keep asking for a user, so a read key
 * refuses them rather than quietly reaching further than it was meant to.
 *
 * A read key is a project token carrying `project:read`
 * (app/Support/project-tokens.ts). One that belongs to a different project
 * answers 404 rather than 403, matching canAccessProject: a caller who cannot
 * read a project should not learn it exists.
 */
export async function projectReadAccess(request: any, projectId: string): Promise<ProjectReadAccess> {
  const presented = bearerFrom(request)

  const key = await projectForToken(presented, PROJECT_SCOPES.read)
  if (key) {
    if (key.projectId !== String(projectId))
      return { ok: false, status: 404, error: 'not found' }
    if (!key.isActive)
      return { ok: false, status: 403, error: 'project inactive' }
    return { ok: true, as: 'key' }
  }

  // A person signed in, or an API token of theirs that may read issues.
  const user = await userWithScope(presented, TOKEN_SCOPES.read)
  if (!user)
    return { ok: false, status: 401, error: 'unauthorized' }
  if (!(await canAccessProject(user, projectId)))
    return { ok: false, status: 404, error: 'not found' }
  return { ok: true, as: 'user', user }
}

export type ProjectTriageAccess =
  | { ok: true, user: any }
  | { ok: false, status: 401 | 404, error: string }

/**
 * Who may change the status of this project's issues: a person signed in, or
 * an API token of theirs carrying `issues:triage`. Either way it is somebody
 * who can access the project, owner or member, as the issue page's own
 * buttons allow.
 *
 * A read key is not a person's token and is refused: reading a project does
 * not come with closing its issues.
 */
export async function projectTriageAccess(request: any, projectId: string): Promise<ProjectTriageAccess> {
  const user = await userWithScope(bearerFrom(request), TOKEN_SCOPES.triage)
  if (!user)
    return { ok: false, status: 401, error: 'unauthorized' }
  if (!(await canAccessProject(user, projectId)))
    return { ok: false, status: 404, error: 'not found' }
  return { ok: true, user }
}

/**
 * Where an upload token may upload: its project, when the token is a live
 * project token carrying `project:upload` and the project is active. Null
 * otherwise.
 *
 * The project is read on every upload, so a token stops working the moment
 * its project is archived or deleted without anybody having to revoke it. It
 * belongs to the project and not to a person, so nobody's password change or
 * departure ends it.
 */
export async function uploadTarget(token: string): Promise<{ projectId: string, tokenId: string } | null> {
  const target = await projectForToken(token, PROJECT_SCOPES.upload)
  return target && target.isActive ? { projectId: target.projectId, tokenId: target.tokenId } : null
}
