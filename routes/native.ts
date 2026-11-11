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

import { db } from '@stacksjs/database'
import { route } from '@stacksjs/router'
import { randomId } from '../app/Errors/fingerprint'
import { displayPrefix, generateUploadToken, hashUploadToken } from '../app/Errors/uploadTokens'
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

route.get('/api/projects/{projectId}/upload-tokens', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  const projectId = request.params.projectId
  if (!(await ownsProject(user, projectId)))
    return json({ error: 'not found' }, 404)
  const tokens = await db.unsafe(
    `SELECT id, name, token_prefix, last_used_at, revoked_at, created_at
       FROM upload_tokens WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  )
  return json({ tokens: tokens ?? [] })
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
  const name = String(request.jsonBody?.name ?? '').trim().slice(0, 120) || 'CI'
  const token = generateUploadToken()
  const id = `upt_${randomId().slice(0, 20)}`
  await db.unsafe(
    `INSERT INTO upload_tokens (id, project_id, name, token_hash, token_prefix, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [id, projectId, name, hashUploadToken(token), displayPrefix(token), Number(user.id)],
  )
  // The only response that will ever carry the plaintext.
  return json({ token, id, name, token_prefix: displayPrefix(token) }, 201)
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
  await db.unsafe(
    'UPDATE upload_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1 AND project_id = $2',
    [request.params.tokenId, projectId],
  )
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
