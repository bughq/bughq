import type { NativeException, NativePlatform } from '../Errors/native'
import type { AppleSymbolMap } from './apple'
import type { ProguardMapping } from './proguard'
import type { JsSymbolication, SourceMapIndex } from './sourcemap'
import { createHash } from 'node:crypto'
import { db } from '@stacksjs/database'
import { randomId } from '../Errors/fingerprint'
import { isApplePlatform, isJvmInApp, symbolicateAppleFrames } from '../Errors/native'
import { lookupSymbol, normalizeUuid, packSymbolMap, parseSymbolsOutput, unpackSymbolMap } from './apple'
import { parseMapping, retraceClassNames, retraceFrames } from './proguard'
import { jsStackFiles, matchScript, parseSourceMap, symbolicateJsStack } from './sourcemap'

/**
 * Debug-file storage and the symbolication step of the ingest.
 *
 * Parsed maps are cached per process. A crash storm from one bad build hits the
 * same two or three binaries thousands of times, so after the first event each
 * lookup is a binary search in memory. A miss is cached briefly too: a project
 * that never uploads symbols must not cost a query per crash.
 */

/**
 * Runs one SQL statement. In the app this is always the database; the
 * parameter exists so the upload and symbolication paths can be exercised end
 * to end against an in-memory stand-in (tests/unit/sourcemap.test.ts).
 */
export type Sql = (query: string, params?: unknown[]) => Promise<any[] | undefined>
export const database: Sql = (query, params) => db.unsafe(query, params as any[]) as unknown as Promise<any[] | undefined>

const MAX_CACHED = 24
const MISS_TTL_MS = 60_000

type Entry<T> = { value: T | null, at: number }
const appleCache = new Map<string, Entry<AppleSymbolMap>>()
const proguardCache = new Map<string, Entry<ProguardMapping>>()
const sourceMapCache = new Map<string, Entry<SourceMapIndex>>()
/** Which scripts a release has maps for: script name to the map's `debug_id`. */
const sourceMapListCache = new Map<string, Entry<Map<string, string>>>()

function remember<T>(cache: Map<string, Entry<T>>, key: string, value: T | null): void {
  cache.delete(key)
  cache.set(key, { value, at: Date.now() })
  while (cache.size > MAX_CACHED)
    cache.delete(cache.keys().next().value as string)
}

function recall<T>(cache: Map<string, Entry<T>>, key: string): Entry<T> | undefined {
  const hit = cache.get(key)
  if (!hit)
    return undefined
  if (hit.value === null && Date.now() - hit.at > MISS_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  // Refresh recency.
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

/** Drop cached maps for a project, after an upload replaced them. */
export function forgetProject(projectId: string): void {
  for (const cache of [appleCache, proguardCache, sourceMapCache, sourceMapListCache] as Array<Map<string, unknown>>) {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${projectId}:`))
        cache.delete(key)
    }
  }
}

async function loadApple(projectId: string, uuid: string): Promise<AppleSymbolMap | null> {
  const key = `${projectId}:${uuid}`
  const cached = recall(appleCache, key)
  if (cached)
    return cached.value
  const row = (await db.unsafe(
    `SELECT content FROM debug_files WHERE project_id = $1 AND kind = 'apple' AND debug_id = $2 LIMIT 1`,
    [projectId, uuid],
  ))?.[0]
  let map: AppleSymbolMap | null = null
  try {
    map = row?.content ? unpackSymbolMap(String(row.content)) : null
  }
  catch (err) {
    console.error('[symbols] unreadable apple map', uuid, err instanceof Error ? err.message : err)
  }
  remember(appleCache, key, map)
  return map
}

async function loadProguard(projectId: string, release: string): Promise<ProguardMapping | null> {
  const key = `${projectId}:${release}`
  const cached = recall(proguardCache, key)
  if (cached)
    return cached.value
  const row = (await db.unsafe(
    `SELECT content FROM debug_files WHERE project_id = $1 AND kind = 'proguard' AND debug_id = $2 LIMIT 1`,
    [projectId, release],
  ))?.[0]
  let mapping: ProguardMapping | null = null
  try {
    mapping = row?.content ? parseMapping(Buffer.from(Bun.gunzipSync(Buffer.from(String(row.content), 'base64'))).toString('utf8')) : null
  }
  catch (err) {
    console.error('[symbols] unreadable proguard mapping', release, err instanceof Error ? err.message : err)
  }
  remember(proguardCache, key, mapping)
  return mapping
}

export interface SymbolicationResult {
  exception: NativeException
  /** Frames that gained a name or a line here. */
  symbolicated: number
  /** Apple images seen in the frames with no uploaded symbols (for the issue page hint). */
  missing: string[]
  /** For Android: the message with obfuscated class names restored. */
  message?: string
  type?: string
}

/**
 * Symbolicate an exception in place of the device's raw frames.
 *
 * Never throws: a broken map or a database hiccup leaves the frames as they
 * came, because an unreadable crash is still better than a dropped one.
 */
export async function symbolicate(
  projectId: string,
  platform: NativePlatform,
  release: string | null,
  exception: NativeException,
  opts: { appPackage?: string, type?: string, message?: string } = {},
): Promise<SymbolicationResult> {
  try {
    if (isApplePlatform(platform)) {
      const uuids = new Set<string>()
      const all = [exception.frames, ...(exception.causes ?? []).map(c => c.frames)]
      for (const frames of all) {
        for (const f of frames) {
          if (f.image_uuid && f.in_app)
            uuids.add(normalizeUuid(f.image_uuid))
        }
      }
      const maps = new Map<string, AppleSymbolMap | null>()
      for (const uuid of uuids)
        maps.set(uuid, await loadApple(projectId, uuid))
      const resolve = (uuid: string, offset: number) => {
        const map = maps.get(normalizeUuid(uuid))
        return map ? lookupSymbol(map, offset) : null
      }
      const top = symbolicateAppleFrames(exception.frames, resolve)
      let count = top.symbolicated
      const causes = exception.causes?.map((c) => {
        const r = symbolicateAppleFrames(c.frames, resolve)
        count += r.symbolicated
        return { ...c, frames: r.frames }
      })
      const missing = [...maps].filter(([, m]) => !m).map(([uuid]) => {
        const frame = exception.frames.find(f => f.image_uuid && normalizeUuid(f.image_uuid) === uuid)
        return `${frame?.image ?? 'binary'} ${uuid}`
      })
      return { exception: { ...exception, frames: top.frames, causes }, symbolicated: count, missing }
    }

    // Windows and Linux: the reporter resolved what it could on the machine
    // (export names, dladdr), and there is no PDB or DWARF reader here to do
    // better. The frames are kept as they came and still group by position.
    if (platform !== 'android')
      return { exception, symbolicated: 0, missing: [], type: opts.type, message: opts.message }

    // Android: retrace with the mapping for this release, when there is one,
    // then judge in-app frames by the (now readable) class names.
    const mapping = release ? await loadProguard(projectId, release) : null
    const fix = (frames: NativeException['frames']) => {
      const retraced = mapping ? retraceFrames(mapping, frames) : frames
      return retraced.map(f => ({ ...f, in_app: f.module ? isJvmInApp(f.module, opts.appPackage) : f.in_app }))
    }
    const frames = fix(exception.frames)
    const causes = exception.causes?.map(c => ({
      type: mapping ? retraceClassNames(mapping, c.type) : c.type,
      value: mapping ? retraceClassNames(mapping, c.value) : c.value,
      frames: fix(c.frames),
    }))
    return {
      exception: { ...exception, frames, causes },
      symbolicated: mapping ? frames.length : 0,
      missing: mapping || !release ? [] : [`mapping.txt for ${release}`],
      type: mapping && opts.type ? retraceClassNames(mapping, opts.type) : opts.type,
      message: mapping && opts.message ? retraceClassNames(mapping, opts.message) : opts.message,
    }
  }
  catch (err) {
    console.error('[symbols] symbolication failed:', err instanceof Error ? err.message : err)
    return { exception, symbolicated: 0, missing: [] }
  }
}

export const DEBUG_FILE_KINDS = ['apple', 'proguard', 'sourcemap'] as const
export type DebugFileKind = typeof DEBUG_FILE_KINDS[number]

/**
 * Which kind an upload is, when the request did not say. A sourcemap is JSON
 * with `mappings` (or `sections`); a ProGuard mapping has `original -> a.b:`
 * class rows; anything else is taken for a `symbols` dump.
 */
export function detectDebugFileKind(text: string): DebugFileKind {
  const head = text.slice(0, 4096)
  if (/^\s*(?:\)\]\}'[^\n]*\n)?\s*\{/.test(head) && /"(?:mappings|sections)"\s*:/.test(text))
    return 'sourcemap'
  return /->\s\S+:$/m.test(head) ? 'proguard' : 'apple'
}

export interface StoredDebugFile {
  id: string
  kind: DebugFileKind
  debug_id: string
  code_name: string | null
  arch: string | null
  release: string | null
  symbol_count: number
  size_bytes: number
}

/** Store every binary found in a `symbols` dump. Replaces an earlier upload of the same UUID. */
export async function storeAppleSymbols(projectId: string, text: string, uploadedBy: string | null, sql: Sql = database): Promise<StoredDebugFile[]> {
  const maps = parseSymbolsOutput(text)
  const stored: StoredDebugFile[] = []
  for (const map of maps) {
    const content = packSymbolMap(map)
    const row: StoredDebugFile = {
      id: randomId(),
      kind: 'apple',
      debug_id: map.uuid,
      code_name: map.image.slice(0, 255),
      arch: map.arch.slice(0, 32),
      release: null,
      symbol_count: map.functions.length,
      size_bytes: content.length,
    }
    await sql(
      `INSERT INTO debug_files (id, project_id, kind, debug_id, code_name, arch, release, symbol_count, size_bytes, content, uploaded_by, created_at)
       VALUES ($1, $2, 'apple', $3, $4, $5, NULL, $6, $7, $8, $9, NOW())
       ON CONFLICT (project_id, kind, debug_id) DO UPDATE SET
         code_name = EXCLUDED.code_name, arch = EXCLUDED.arch, symbol_count = EXCLUDED.symbol_count,
         size_bytes = EXCLUDED.size_bytes, content = EXCLUDED.content, uploaded_by = EXCLUDED.uploaded_by,
         created_at = NOW()`,
      [row.id, projectId, row.debug_id, row.code_name, row.arch, row.symbol_count, row.size_bytes, content, uploadedBy],
    )
    stored.push(row)
  }
  forgetProject(projectId)
  return stored
}

/** Store an R8/ProGuard mapping for one release. Replaces an earlier upload for it. */
export async function storeProguardMapping(projectId: string, release: string, text: string, uploadedBy: string | null, sql: Sql = database): Promise<StoredDebugFile | null> {
  const mapping = parseMapping(text)
  if (!mapping.classes.size)
    return null
  const content = Buffer.from(Bun.gzipSync(Buffer.from(text))).toString('base64')
  const row: StoredDebugFile = {
    id: randomId(),
    kind: 'proguard',
    debug_id: release,
    code_name: 'mapping.txt',
    arch: null,
    release,
    symbol_count: mapping.classes.size,
    size_bytes: content.length,
  }
  await sql(
    `INSERT INTO debug_files (id, project_id, kind, debug_id, code_name, arch, release, symbol_count, size_bytes, content, uploaded_by, created_at)
     VALUES ($1, $2, 'proguard', $3, 'mapping.txt', NULL, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (project_id, kind, debug_id) DO UPDATE SET
       symbol_count = EXCLUDED.symbol_count, size_bytes = EXCLUDED.size_bytes,
       content = EXCLUDED.content, uploaded_by = EXCLUDED.uploaded_by, created_at = NOW()`,
    [row.id, projectId, release, row.symbol_count, row.size_bytes, content, uploadedBy],
  )
  forgetProject(projectId)
  return row
}

// ---------------------------------------------------------------------------
// JavaScript sourcemaps
// ---------------------------------------------------------------------------

/**
 * A sourcemap's identity. Like a ProGuard mapping it belongs to a release, but
 * a release has one map per script, so the key is the release AND the script's
 * name. Hashed because the two together can outgrow `debug_id` (128 chars); the
 * readable halves live in `release` and `code_name`.
 */
export function sourceMapDebugId(release: string, file: string): string {
  return createHash('sha256').update(`${release}\n${file}`).digest('hex')
}

/** The script name an upload is filed under: no query, forward slashes, no leading `./` or `/`. */
export function sourceMapFileName(value: unknown): string {
  return String(value ?? '').trim().replace(/[?#].*$/, '').replace(/\\/g, '/').replace(/^(?:\.\/|~\/|\/)+/, '').replace(/\.map$/i, '').slice(0, 255)
}

/**
 * Store the sourcemap of one script of one release. Replaces an earlier upload
 * for the same release and script. Returns null when the text is not a
 * readable sourcemap.
 *
 * Stored whole, `sourcesContent` included: a bundler that writes no `names`
 * (Bun's) leaves the original source as the only place a function's real name
 * can be read from, and minified names would regroup every bug on every build.
 */
export async function storeSourceMap(projectId: string, release: string, file: string, text: string, uploadedBy: string | null, sql: Sql = database): Promise<StoredDebugFile | null> {
  const map = parseSourceMap(text)
  if (!map)
    return null
  const content = Buffer.from(Bun.gzipSync(Buffer.from(text))).toString('base64')
  const row: StoredDebugFile = {
    id: randomId(),
    kind: 'sourcemap',
    debug_id: sourceMapDebugId(release, file),
    code_name: file,
    arch: null,
    release,
    symbol_count: map.sources.length,
    size_bytes: content.length,
  }
  await sql(
    `INSERT INTO debug_files (id, project_id, kind, debug_id, code_name, arch, release, symbol_count, size_bytes, content, uploaded_by, created_at)
     VALUES ($1, $2, 'sourcemap', $3, $4, NULL, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (project_id, kind, debug_id) DO UPDATE SET
       code_name = EXCLUDED.code_name, release = EXCLUDED.release, symbol_count = EXCLUDED.symbol_count,
       size_bytes = EXCLUDED.size_bytes, content = EXCLUDED.content, uploaded_by = EXCLUDED.uploaded_by,
       created_at = NOW()`,
    [row.id, projectId, row.debug_id, file, release, row.symbol_count, row.size_bytes, content, uploadedBy],
  )
  forgetProject(projectId)
  return row
}

/** A release's uploaded scripts. One small query per release, then cached, misses included. */
async function listSourceMaps(projectId: string, release: string, sql: Sql): Promise<Map<string, string>> {
  const key = `${projectId}:${release}`
  const cached = recall(sourceMapListCache, key)
  // A found list expires too, unlike a parsed map. A release's maps arrive one
  // upload at a time, and the app and API run as separate processes, so the
  // process that cached "app.js" would otherwise never learn of "agent.js"
  // uploaded a second later through the other one.
  if (cached && Date.now() - cached.at <= MISS_TTL_MS)
    return cached.value ?? new Map()
  const rows = await sql(
    `SELECT debug_id, code_name FROM debug_files WHERE project_id = $1 AND kind = 'sourcemap' AND release = $2 LIMIT 500`,
    [projectId, release],
  )
  const list = new Map<string, string>()
  for (const row of rows ?? [])
    list.set(String(row.code_name), String(row.debug_id))
  remember(sourceMapListCache, key, list.size ? list : null)
  return list
}

async function loadSourceMap(projectId: string, debugId: string, sql: Sql): Promise<SourceMapIndex | null> {
  const key = `${projectId}:${debugId}`
  const cached = recall(sourceMapCache, key)
  if (cached)
    return cached.value
  const row = (await sql(
    `SELECT content FROM debug_files WHERE project_id = $1 AND kind = 'sourcemap' AND debug_id = $2 LIMIT 1`,
    [projectId, debugId],
  ))?.[0]
  let map: SourceMapIndex | null = null
  try {
    map = row?.content ? parseSourceMap(Buffer.from(Bun.gunzipSync(Buffer.from(String(row.content), 'base64'))).toString('utf8')) : null
  }
  catch (err) {
    console.error('[symbols] unreadable sourcemap', debugId, err instanceof Error ? err.message : err)
  }
  remember(sourceMapCache, key, map)
  return map
}

/**
 * Symbolicate a JavaScript `stack` string against the sourcemaps uploaded for
 * its release: a webview error, a Bun agent error, or a minified browser
 * bundle.
 *
 * `missing` names scripts without a map only when the release has some maps,
 * or when `expectMaps` says the sender is a bundled app (a desktop shell). A
 * website that never minifies and never uploads must not be told on every
 * issue that its sourcemaps are missing.
 *
 * Never throws, for the reason `symbolicate` does not.
 */
export async function symbolicateJs(
  projectId: string,
  release: string | null,
  stack: string,
  opts: { expectMaps?: boolean } = {},
  sql: Sql = database,
): Promise<JsSymbolication> {
  const untouched: JsSymbolication = { stack, symbolicated: 0, missing: [] }
  if (!release || !stack)
    return untouched
  try {
    const list = await listSourceMaps(projectId, release, sql)
    if (!list.size && !opts.expectMaps)
      return untouched
    const names = [...list.keys()]
    const maps = new Map<string, SourceMapIndex | null>()
    for (const file of jsStackFiles(stack)) {
      const name = matchScript(names, file)
      maps.set(file, name ? await loadSourceMap(projectId, list.get(name) as string, sql) : null)
    }
    const result = symbolicateJsStack(stack, file => maps.get(file) ?? null)
    return { ...result, missing: result.missing.map(file => `sourcemap for ${file} (${release})`) }
  }
  catch (err) {
    console.error('[symbols] sourcemap symbolication failed:', err instanceof Error ? err.message : err)
    return untouched
  }
}
