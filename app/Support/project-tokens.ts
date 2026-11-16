import { createToken, findToken, revokeTokenById, tokens } from '@stacksjs/auth'
import { db } from '@stacksjs/database'

/**
 * Tokens that act for a project: its read keys and its upload tokens.
 *
 * They are Stacks personal access tokens owned by the project's principal
 * (app/Models/ProjectPrincipal.ts) instead of by a user. Everything about the
 * credential is the framework's: `createToken` mints it and keeps only a
 * hash, `findToken` answers whether it is live, `tokens` lists a principal's,
 * `revokeTokenById` ends one (@stacksjs/auth). This file adds the two things
 * the framework cannot know: which principal stands for which project, and
 * which scope a route is asking for.
 *
 * A project token names what it may do, and the principal says to which
 * project. It grants nothing else and it is nobody's session: the framework
 * resolves only `users` tokens to a user, and app/Support/access.ts asks for
 * a full session everywhere a person is required.
 */

/** The table whose rows own project tokens: `tokenable_type` for all of them. */
export const PROJECT_TOKEN_OWNER = 'project_principals'

export const PROJECT_SCOPES = {
  /** Read this project's issues: what a read key carries. */
  read: 'project:read',
  /** Upload this project's debug files: what an upload token carries. */
  upload: 'project:upload',
} as const

export type ProjectScope = typeof PROJECT_SCOPES[keyof typeof PROJECT_SCOPES]

/**
 * How long a project token lasts.
 *
 * It sits in another system's configuration (a dashboard's server, a CI
 * secret) and is used unattended, so it is given the longest life used here
 * rather than one that breaks a deployment on an anniversary. It is revocable
 * at any point.
 */
export const PROJECT_TOKEN_LIFETIME_DAYS = 3650

export function projectTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + PROJECT_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
}

/** The fields of a framework token this file reads. */
export interface TokenFacts {
  id: number
  subjectType?: string
  subjectId?: number
  scopes: readonly string[]
}

/**
 * Whether a live token is a project token carrying `scope`.
 *
 * Owned by a principal, never by a user, and naming the scope itself: `*` is
 * what a sign-in carries and is not accepted as a project scope, so a session
 * can never be presented where a project token is asked for.
 */
export function isProjectToken(token: TokenFacts | null | undefined, scope: ProjectScope): token is TokenFacts & { subjectId: number } {
  return !!token
    && token.subjectType === PROJECT_TOKEN_OWNER
    && Number.isSafeInteger(token.subjectId)
    && !token.scopes.includes('*')
    && token.scopes.includes(scope)
}

/** The principal that stands for a project, created the first time it is needed. */
export async function principalId(projectId: string): Promise<number> {
  const existing = (await db.unsafe('SELECT id FROM project_principals WHERE project_id = $1 LIMIT 1', [projectId]))?.[0]
  if (existing)
    return Number(existing.id)
  // Two requests creating it at once is settled by the unique index: the loser
  // inserts nothing and reads the winner's row.
  await db.unsafe(
    'INSERT INTO project_principals (project_id, created_at, updated_at) VALUES ($1, NOW(), NOW()) ON CONFLICT (project_id) DO NOTHING',
    [projectId],
  )
  const created = (await db.unsafe('SELECT id FROM project_principals WHERE project_id = $1 LIMIT 1', [projectId]))?.[0]
  if (!created)
    throw new Error(`No principal for project ${projectId}`)
  return Number(created.id)
}

export interface ProjectTokenView {
  id: string
  name: string
  created_at: string
  expires_at: string | null
}

/** Mint a token for a project. The plaintext is in this answer and nowhere afterwards. */
export async function mintProjectToken(projectId: string, scope: ProjectScope, name: string): Promise<{ token: string, id: string }> {
  const owner = await principalId(projectId)
  // One scope, and no refresh token: a project token is replaced by minting
  // another, and a refresh credential would be a second secret nobody uses.
  const created = await createToken(owner, name, [scope], {
    tokenableType: PROJECT_TOKEN_OWNER,
    expiresAt: projectTokenExpiry(),
    withRefreshToken: false,
  })
  return { token: created.plainTextToken, id: String(created.accessToken.id) }
}

/** A project's live tokens carrying `scope`, newest first. */
export async function projectTokens(projectId: string, scope: ProjectScope): Promise<ProjectTokenView[]> {
  const owner = (await db.unsafe('SELECT id FROM project_principals WHERE project_id = $1 LIMIT 1', [projectId]))?.[0]
  if (!owner)
    return []
  const now = Date.now()
  return (await tokens(Number(owner.id), PROJECT_TOKEN_OWNER))
    .filter(token => isProjectToken({ ...token, subjectType: PROJECT_TOKEN_OWNER, subjectId: Number(owner.id) }, scope))
    .filter(token => token.expiresAt == null || token.expiresAt.getTime() > now)
    .map(token => ({
      id: String(token.id),
      name: token.name,
      created_at: token.createdAt.toISOString(),
      expires_at: token.expiresAt ? token.expiresAt.toISOString() : null,
    }))
}

/**
 * Revoke one of a project's tokens. The id is looked up among that project's
 * tokens for the scope rather than trusted, so an id from another project, or
 * a person's session, revokes nothing. Answers whether anything was revoked.
 */
export async function revokeProjectToken(projectId: string, scope: ProjectScope, tokenId: unknown): Promise<boolean> {
  const wanted = String(tokenId ?? '')
  const owned = (await projectTokens(projectId, scope)).find(token => token.id === wanted)
  if (!owned)
    return false
  await revokeTokenById(Number(owned.id))
  return true
}

/** Revoke every token a project holds for `scope`. Answers how many. */
export async function revokeProjectTokens(projectId: string, scope: ProjectScope): Promise<number> {
  const held = await projectTokens(projectId, scope)
  for (const token of held)
    await revokeTokenById(Number(token.id))
  return held.length
}

export interface ProjectTokenTarget {
  projectId: string
  tokenId: string
  /** The account the project belongs to, or null when it has none. */
  ownerId: number | null
  isActive: boolean
}

/**
 * The project a presented bearer acts for, when it is a live project token
 * carrying `scope`. Null otherwise: not a token, revoked, expired, a person's
 * token, a token for another scope, or one whose project is gone.
 */
export async function projectForToken(presented: string, scope: ProjectScope): Promise<ProjectTokenTarget | null> {
  if (!presented)
    return null
  let token: TokenFacts | null
  try {
    token = await findToken(presented)
  }
  catch {
    return null
  }
  if (!isProjectToken(token, scope))
    return null
  const row = (await db.unsafe(
    `SELECT p.id, p.owner_id, p.is_active FROM project_principals pp JOIN projects p ON p.id = pp.project_id
     WHERE pp.id = $1 LIMIT 1`,
    [token.subjectId],
  ))?.[0]
  if (!row)
    return null
  return {
    projectId: String(row.id),
    tokenId: String(token.id),
    ownerId: row.owner_id == null ? null : Number(row.owner_id),
    isActive: !(row.is_active === false || row.is_active === 0),
  }
}
