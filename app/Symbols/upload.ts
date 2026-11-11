import type { Sql } from './store'
import { rateLimit as defaultRateLimit } from '../Errors/limits'
import { hashUploadToken, tokenFromAuthorization } from '../Errors/uploadTokens'
import { database, detectDebugFileKind, sourceMapFileName, storeAppleSymbols, storeProguardMapping, storeSourceMap } from './store'

/**
 * `POST /api/debug-files`: build tooling uploads what makes a release's stacks
 * readable. One endpoint, one credential (the upload token, never the public
 * ingest key; see database/migrations/0000000043), three kinds:
 *
 *   ?kind=apple                              the output of `symbols -arch arm64 <dSYM>`
 *   ?kind=proguard&release=1.0.0+41          an R8 mapping.txt
 *   ?kind=sourcemap&release=1.0.0+41&file=app.js   a JavaScript sourcemap
 *
 * The body is the file itself, gzipped or plain. Kept out of routes/native.ts
 * so it can be called with a plain Request and an in-memory database in
 * tests/unit/sourcemap.test.ts.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * A `symbols` dump of a large app is tens of megabytes of text, but compresses
 * about tenfold, and the build tooling always sends it gzipped. Bounded so a
 * stolen token cannot fill the database with one request.
 */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024
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

export interface DebugFileUploadDeps {
  sql?: Sql
  rateLimit?: typeof defaultRateLimit
}

export async function handleDebugFileUpload(request: any, deps: DebugFileUploadDeps = {}): Promise<Response> {
  const sql = deps.sql ?? database
  const rateLimit = deps.rateLimit ?? defaultRateLimit

  const token = tokenFromAuthorization(request.headers?.get?.('authorization'))
  if (!token)
    return json({ error: 'missing upload token' }, 401)

  const limit = await rateLimit(`upload:${hashUploadToken(token).slice(0, 16)}`, 30, 60_000)
  if (!limit.ok)
    return json({ error: 'rate limited' }, 429)

  const owner = (await sql(
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
  const kind = url.searchParams.get('kind') ?? detectDebugFileKind(text)
  const projectId = String(owner.project_id)
  const tokenId = String(owner.id)
  await sql('UPDATE upload_tokens SET last_used_at = NOW() WHERE id = $1', [tokenId])

  if (kind === 'apple') {
    const files = await storeAppleSymbols(projectId, text, tokenId, sql)
    if (!files.length)
      return json({ error: 'no symbols found: send the output of `symbols -arch arm64 <dSYM>`' }, 422)
    return json({ ok: true, files }, 201)
  }
  if (kind === 'proguard') {
    const release = String(url.searchParams.get('release') ?? '').trim().slice(0, 128)
    if (!release)
      return json({ error: 'a mapping needs ?release=<the release the app reports, e.g. 1.0.0+41>' }, 422)
    const file = await storeProguardMapping(projectId, release, text, tokenId, sql)
    if (!file)
      return json({ error: 'no class mappings found in this mapping.txt' }, 422)
    return json({ ok: true, files: [file] }, 201)
  }
  if (kind === 'sourcemap') {
    // Keyed like a mapping.txt, by the release the app reports, plus the
    // script the map belongs to, since a release ships more than one.
    const release = String(url.searchParams.get('release') ?? '').trim().slice(0, 128)
    if (!release)
      return json({ error: 'a sourcemap needs ?release=<the release the app reports, e.g. 1.0.0+41>' }, 422)
    let file = sourceMapFileName(url.searchParams.get('file') ?? url.searchParams.get('name'))
    if (!file) {
      // The map usually names its own script in `file`.
      try {
        file = sourceMapFileName(JSON.parse(text).file)
      }
      catch {}
    }
    if (!file)
      return json({ error: 'a sourcemap needs ?file=<the script it maps, as stack frames name it, e.g. app.js>' }, 422)
    const stored = await storeSourceMap(projectId, release, file, text, tokenId, sql)
    if (!stored)
      return json({ error: 'not a readable sourcemap: send the .map file the bundler wrote (version 3)' }, 422)
    return json({ ok: true, files: [stored] }, 201)
  }
  return json({ error: 'kind must be apple, proguard or sourcemap' }, 400)
}
