/**
 * bughq — native app support: upload tokens, debug files, release health.
 *
 *   POST   /api/debug-files                      upload a dSYM symbol dump, a mapping.txt or a sourcemap (upload token)
 *   GET    /api/projects/{id}/debug-files        list them (members)
 *   DELETE /api/projects/{id}/debug-files/{fid}  remove one (owner)
 *   GET    /api/projects/{id}/upload-tokens      list tokens (owner)
 *   POST   /api/projects/{id}/upload-tokens      create one; the plaintext is returned once (owner)
 *   DELETE /api/projects/{id}/upload-tokens/{tid} revoke (owner)
 *   GET    /api/projects/{id}/releases           crash-free sessions per release (members)
 *
 * The session and event ingest stay in routes/errors.ts with the rest of the
 * public, ingest-key-authenticated surface.
 */

import { createToken, revokeTokenById, tokens } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { route } from '@stacksjs/router'
import { uploadScope, uploadTokenExpiry, uploadTokenName } from '../app/Errors/uploadTokens'
import type { ReleaseHealthRow } from '../app/Releases/health'
import { withCrashFree } from '../app/Releases/health'
import { canAccessProject, currentUser, ownsProject } from '../app/Support/access'
import { sameOrigin } from '../app/Support/origin'
import { handleDebugFileUpload } from '../app/Symbols/upload'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

// ---------------------------------------------------------------------------
// Debug file upload (build tooling)
// ---------------------------------------------------------------------------

// Build tooling, authenticated by the upload token. See app/Symbols/upload.ts.
route.post('/api/debug-files', (request: any) => handleDebugFileUpload(request)).skipCsrf()

// ---------------------------------------------------------------------------
// Debug files (dashboard)
// ---------------------------------------------------------------------------

route.get('/api/projects/{projectId}/debug-files', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await canAccessProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  const files = await db.unsafe(
    `SELECT id, kind, debug_id, code_name, arch, release, symbol_count, size_bytes, created_at
       FROM debug_files WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [projectId],
  )
  return json({ files: files ?? [] })
})

route.delete('/api/projects/{projectId}/debug-files/{fileId}', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  await db.unsafe('DELETE FROM debug_files WHERE id = $1 AND project_id = $2', [request.params.fileId, projectId])
  return json({ ok: true })
}).skipCsrf()

// ---------------------------------------------------------------------------
// Upload tokens (owner-only)
// ---------------------------------------------------------------------------

// Upload tokens are Stacks personal access tokens (app/Errors/uploadTokens.ts).
// The project's owner holds them, each carrying the scope that names this
// project, so a project's tokens are the owner's live tokens with that scope.

/** How long a token has gone unused for it to read as "never used". */
function usedAt(token: { createdAt: Date, updatedAt: Date }): string | null {
  // The framework stamps a token as it is used, and writes the same stamp at
  // creation: a token whose two times match has not been used.
  return token.updatedAt.getTime() - token.createdAt.getTime() > 1000 ? token.updatedAt.toISOString() : null
}

async function uploadTokensOf(ownerId: number, projectId: string): Promise<Awaited<ReturnType<typeof tokens>>> {
  const scope = uploadScope(projectId)
  const now = Date.now()
  return (await tokens(ownerId))
    .filter(token => !token.scopes.includes('*') && token.scopes.includes(scope))
    .filter(token => token.expiresAt == null || token.expiresAt.getTime() > now)
}

route.get('/api/projects/{projectId}/upload-tokens', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  const held = await uploadTokensOf(Number(user.id), projectId)
  return json({
    tokens: held.map(token => ({
      id: String(token.id),
      name: token.name,
      last_used_at: usedAt(token),
      created_at: token.createdAt.toISOString(),
    })),
  })
})

route.post('/api/projects/{projectId}/upload-tokens', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  const name = uploadTokenName(request.jsonBody?.name)
  // One scope, naming this project, and no refresh token: an upload token is
  // replaced by creating another.
  const created = await createToken(Number(user.id), name, [uploadScope(projectId)], { expiresAt: uploadTokenExpiry(), withRefreshToken: false })
  // The only response that will ever carry the plaintext.
  return json({ token: created.plainTextToken, id: String(created.accessToken.id), name }, 201)
}).skipCsrf()

route.delete('/api/projects/{projectId}/upload-tokens/{tokenId}', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  // Looked up among this project's tokens rather than trusted, so an id that
  // belongs to another project, or to a session, revokes nothing.
  const tokenId = Number(request.params.tokenId)
  const owned = Number.isSafeInteger(tokenId)
    ? (await uploadTokensOf(Number(user.id), projectId)).find(token => token.id === tokenId)
    : undefined
  if (owned)
    await revokeTokenById(owned.id)
  return json({ ok: true })
}).skipCsrf()

// ---------------------------------------------------------------------------
// Release health (dashboard)
// ---------------------------------------------------------------------------

route.get('/api/projects/{projectId}/releases', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await canAccessProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  const days = Math.max(1, Math.min(90, Number(request.query?.days ?? 30) || 30))
  const rows = await db.unsafe(
    `SELECT release,
            COUNT(*)::int                                        AS sessions,
            COUNT(*) FILTER (WHERE status = 'crashed')::int      AS crashed,
            COUNT(*) FILTER (WHERE status = 'abnormal')::int     AS abnormal,
            COUNT(*) FILTER (WHERE status = 'errored')::int      AS errored,
            COUNT(DISTINCT user_hash)::int                       AS users,
            MIN(started_at)                                      AS first_seen,
            MAX(started_at)                                      AS last_seen
       FROM app_sessions
      WHERE project_id = $1 AND started_at > NOW() - make_interval(days => $2)
      GROUP BY release
      ORDER BY MAX(started_at) DESC
      LIMIT 20`,
    [projectId, days],
  )
  return json({ days, releases: withCrashFree((rows ?? []) as unknown as ReleaseHealthRow[]) })
})
