import type { NativeException, NativePlatform } from '../Errors/native'
import type { AppleSymbolMap } from './apple'
import type { ProguardMapping } from './proguard'
import { db } from '@stacksjs/database'
import { randomId } from '../Errors/fingerprint'
import { isJvmInApp, symbolicateAppleFrames } from '../Errors/native'
import { lookupSymbol, normalizeUuid, packSymbolMap, parseSymbolsOutput, unpackSymbolMap } from './apple'
import { parseMapping, retraceClassNames, retraceFrames } from './proguard'

/**
 * Debug-file storage and the symbolication step of the ingest.
 *
 * Parsed maps are cached per process. A crash storm from one bad build hits the
 * same two or three binaries thousands of times, so after the first event each
 * lookup is a binary search in memory. A miss is cached briefly too: a project
 * that never uploads symbols must not cost a query per crash.
 */

const MAX_CACHED = 24
const MISS_TTL_MS = 60_000

type Entry<T> = { value: T | null, at: number }
const appleCache = new Map<string, Entry<AppleSymbolMap>>()
const proguardCache = new Map<string, Entry<ProguardMapping>>()

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
  for (const cache of [appleCache, proguardCache] as Array<Map<string, unknown>>) {
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
    if (platform === 'ios') {
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

export interface StoredDebugFile {
  id: string
  kind: 'apple' | 'proguard'
  debug_id: string
  code_name: string | null
  arch: string | null
  release: string | null
  symbol_count: number
  size_bytes: number
}

/** Store every binary found in a `symbols` dump. Replaces an earlier upload of the same UUID. */
export async function storeAppleSymbols(projectId: string, text: string, uploadedBy: string | null): Promise<StoredDebugFile[]> {
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
    await db.unsafe(
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
export async function storeProguardMapping(projectId: string, release: string, text: string, uploadedBy: string | null): Promise<StoredDebugFile | null> {
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
  await db.unsafe(
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
