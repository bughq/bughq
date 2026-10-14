/**
 * bughq — native app support: upload tokens, debug files, release health.
 *
 *   POST   /api/debug-files                      upload a dSYM symbol dump or a mapping.txt (upload token)
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
import { displayPrefix, generateUploadToken, hashUploadToken, tokenFromAuthorization } from '../app/Errors/uploadTokens'
import { rateLimit } from '../app/Errors/limits'
import type { ReleaseHealthRow } from '../app/Releases/health'
import { withCrashFree } from '../app/Releases/health'
import { canAccessProject, currentUser, ownsProject } from '../app/Support/access'
import { sameOrigin } from '../app/Support/origin'
import { storeAppleSymbols, storeProguardMapping } from '../app/Symbols/store'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * A `symbols` dump of a large app is tens of megabytes of text, but compresses
 * about tenfold, and the build tooling always sends it gzipped. Bounded so a
 * stolen token cannot fill the database with one request.
 */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024

async function requestBytes(request: any): Promise<Uint8Array<ArrayBuffer> | null> {
  // The router has usually not consumed a non-JSON body; read it raw. A
  // clone keeps this working if a middleware already looked at it.
  const source = typeof request.clone === 'function' ? request.clone() : request
  if (typeof source.arrayBuffer !== 'function')
    return null
  return new Uint8Array(await source.arrayBuffer())
}

function decodeUpload(bytes: Uint8Array<ArrayBuffer>): string {
  const gz = bytes.length > 2 && bytes[0] === 0x1F && bytes[1] === 0x8B
  const raw = gz ? Bun.gunzipSync(bytes) : bytes
  if (raw.byteLength > MAX_UNCOMPRESSED_BYTES)
    throw new Error('upload too large once decompressed')
  return new TextDecoder().decode(raw)
}

// ---------------------------------------------------------------------------
// Debug file upload (build tooling)
// ---------------------------------------------------------------------------

route.post('/api/debug-files', async (request: any) => {
  const token = tokenFromAuthorization(request.headers?.get?.('authorization'))
  if (!token)
    return json({ error: 'missing upload token' }, 401)

  const limit = await rateLimit(`upload:${hashUploadToken(token).slice(0, 16)}`, 30, 60_000)
  if (!limit.ok)
    return json({ error: 'rate limited' }, 429)

  const owner = (await db.unsafe(
    `SELECT t.id, t.project_id FROM upload_tokens t JOIN projects p ON p.id = t.project_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND p.is_active IS NOT FALSE LIMIT 1`,
    [hashUploadToken(token)],
  ))?.[0]
  if (!owner)
    return json({ error: 'invalid upload token' }, 401)

  const declared = Number(request.headers?.get?.('content-length') || 0)
  if (declared > MAX_UPLOAD_BYTES)
    return json({ error: 'upload too large' }, 413)
  const bytes = await requestBytes(request)
  if (!bytes || !bytes.byteLength)
    return json({ error: 'empty upload' }, 400)
  if (bytes.byteLength > MAX_UPLOAD_BYTES)
    return json({ error: 'upload too large' }, 413)

  let text: string
  try {
    text = decodeUpload(bytes)
  }
  catch (err) {
    return json({ error: err instanceof Error ? err.message : 'unreadable upload' }, 400)
  }

  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') ?? (/->\s\S+:$/m.test(text.slice(0, 4096)) ? 'proguard' : 'apple')
  const projectId = String(owner.project_id)
  const tokenId = String(owner.id)
  await db.unsafe('UPDATE upload_tokens SET last_used_at = NOW() WHERE id = $1', [tokenId])

  if (kind === 'apple') {
    const files = await storeAppleSymbols(projectId, text, tokenId)
    if (!files.length)
      return json({ error: 'no symbols found: send the output of `symbols -arch arm64 <dSYM>`' }, 422)
    return json({ ok: true, files }, 201)
  }
  if (kind === 'proguard') {
    const release = String(url.searchParams.get('release') ?? '').trim().slice(0, 128)
    if (!release)
      return json({ error: 'a mapping needs ?release=<the release the app reports, e.g. 1.0.0+41>' }, 422)
    const file = await storeProguardMapping(projectId, release, text, tokenId)
    if (!file)
      return json({ error: 'no class mappings found in this mapping.txt' }, 422)
    return json({ ok: true, files: [file] }, 201)
  }
  return json({ error: 'kind must be apple or proguard' }, 400)
}).skipCsrf() // build tooling, authenticated by the upload token

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
