/**
 * Native (iOS and Android) events.
 *
 * A browser error arrives as a `stack` string and is grouped by its type,
 * message and top frame. A native crash is different in three ways, and this
 * module handles all three:
 *
 *  1. Its frames arrive STRUCTURED in `exception.frames`. An iOS frame is
 *     `image + offset` (HQTraining + 0x1a2b) and means nothing until it is
 *     looked up in the build's symbol map. An Android frame is a JVM frame,
 *     possibly obfuscated by R8.
 *  2. Its message is noise for grouping. `EXC_BAD_ACCESS at 0x10` changes with
 *     every address, and an obfuscated class name changes with every build. The
 *     fault is identified by WHERE it happened, so native issues group on the
 *     crash type plus the top in-app frames, not on the message.
 *  3. It names a platform, a build and a device, which the issue page shows.
 *
 * Everything here is pure. The symbol lookups are passed in, so grouping and
 * rendering are testable without a database (see tests/unit/native.test.ts).
 */

export type NativePlatform = 'ios' | 'android'

/** One frame, top of the stack first. Apple and JVM frames share the shape. */
export interface NativeFrame {
  /** Apple: the binary that holds the instruction (HQTraining, UIKitCore). */
  image?: string
  /** Apple: the binary's LC_UUID, any spelling. */
  image_uuid?: string
  /** Apple: instruction address minus the image's load address. */
  image_offset?: number
  /** Apple: the absolute address, kept for display. */
  instruction_addr?: string
  /** A name the device already resolved (system frameworks via dladdr). */
  symbol?: string
  /** Resolved function or JVM method name. */
  function?: string
  /** JVM class, e.g. `com.example.Player`. */
  module?: string
  file?: string
  line?: number
  /** True for the app's own code, false for system frameworks. */
  in_app?: boolean
}

export interface NativeException {
  /** How it was caught: signal, nsexception, metrickit, uncaught, anr, hang, jsc. */
  mechanism: string
  handled: boolean
  /** POSIX signal name, for Apple crashes. */
  signal?: string
  /** Mach exception or termination detail. */
  code?: string
  frames: NativeFrame[]
  /** JVM `Caused by:` chain, outermost first after the top-level exception. */
  causes?: Array<{ type: string, value: string, frames: NativeFrame[] }>
}

const MAX_FRAMES = 128
const MAX_CAUSES = 5

export function isNativePlatform(value: unknown): value is NativePlatform {
  return value === 'ios' || value === 'android'
}

function str(value: unknown, max = 512): string | undefined {
  if (value === null || value === undefined || value === '')
    return undefined
  const s = String(value)
  return s.length > max ? s.slice(0, max) : s
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^0x/i.test(value) ? Number.parseInt(value, 16) : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function cleanFrame(raw: unknown): NativeFrame | null {
  if (!raw || typeof raw !== 'object')
    return null
  const f = raw as Record<string, unknown>
  const frame: NativeFrame = {
    image: str(f.image, 255),
    image_uuid: str(f.image_uuid, 64),
    image_offset: num(f.image_offset),
    instruction_addr: str(f.instruction_addr, 32),
    symbol: str(f.symbol),
    function: str(f.function),
    module: str(f.module),
    file: str(f.file),
    line: num(f.line),
    in_app: typeof f.in_app === 'boolean' ? f.in_app : undefined,
  }
  return frame.image || frame.function || frame.symbol || frame.module ? frame : null
}

function cleanFrames(raw: unknown): NativeFrame[] {
  if (!Array.isArray(raw))
    return []
  const out: NativeFrame[] = []
  for (const r of raw.slice(0, MAX_FRAMES)) {
    const f = cleanFrame(r)
    if (f)
      out.push(f)
  }
  return out
}

/**
 * Validate the wire `exception` block. Anything malformed is dropped rather than
 * rejected: a crash with a broken frame list is still a crash worth an issue,
 * and it then falls back to the ordinary message grouping.
 */
export function parseNativeException(raw: unknown): NativeException | null {
  if (!raw || typeof raw !== 'object')
    return null
  const e = raw as Record<string, unknown>
  const frames = cleanFrames(e.frames)
  const causes = Array.isArray(e.causes)
    ? e.causes.slice(0, MAX_CAUSES).flatMap((c: any) => c && typeof c === 'object'
      ? [{ type: str(c.type, 255) ?? 'Error', value: str(c.value, 2048) ?? '', frames: cleanFrames(c.frames) }]
      : [])
    : undefined
  if (!frames.length && !causes?.length)
    return null
  return {
    mechanism: str(e.mechanism, 32) ?? 'unknown',
    handled: e.handled === true,
    signal: str(e.signal, 32),
    code: str(e.code, 255),
    frames,
    causes: causes?.length ? causes : undefined,
  }
}

const JVM_SYSTEM = /^(?:java|javax|jdk|sun|kotlin|kotlinx|android|androidx|dalvik|libcore|com\.android|com\.google\.android|org\.json|org\.chromium|okhttp3|okio)\./

/**
 * Whether a JVM frame belongs to the app. The device marks frames it can judge
 * (its own package); this is the fallback for frames it could not, and for
 * frames whose class only became readable after retrace.
 */
export function isJvmInApp(module: string | undefined, appPackage?: string): boolean {
  if (!module)
    return false
  if (appPackage && (module === appPackage || module.startsWith(`${appPackage}.`)))
    return true
  return !JVM_SYSTEM.test(module)
}

/** The frame's identity for grouping. Lines are excluded: they drift with every edit. */
export function frameKey(f: NativeFrame): string {
  if (f.module && f.function)
    return `${f.module}.${f.function}`
  if (f.function)
    return f.function.replace(/\s+\+\s+\d+$/, '')
  if (f.image && f.image_offset !== undefined)
    return `${f.image}+0x${f.image_offset.toString(16)}`
  return f.symbol ?? f.image ?? ''
}

/**
 * Grouping parts for a native event: the platform, the crash type, and the top
 * three in-app frames of the deepest exception that has any (a JVM wrapper such
 * as RuntimeException changes from one call site to the next; its cause is the
 * fault). Falls back to the top frames overall when nothing is in-app, e.g. a
 * crash inside a system framework.
 *
 * Unsymbolicated Apple frames group by `image + offset`, which is exact within
 * one build but not across builds. Uploading the build's dSYM is what lets a
 * crash that survives three releases stay one issue.
 */
export function nativeFingerprintParts(platform: NativePlatform, type: string, exception: NativeException): string[] | null {
  const chain = [{ type, frames: exception.frames }, ...(exception.causes ?? [])]
  let pickFrom = chain[0]
  for (const link of chain) {
    if (link.frames.some(f => f.in_app))
      pickFrom = link
  }
  const inApp = pickFrom.frames.filter(f => f.in_app)
  const frames = (inApp.length ? inApp : pickFrom.frames).slice(0, 3).map(frameKey).filter(Boolean)
  if (!frames.length)
    return null
  return ['native', platform, pickFrom === chain[0] ? type : pickFrom.type, ...frames]
}

/** One frame as a stack line, in the shape the issue page and a copy-paste both read. */
export function renderFrame(platform: NativePlatform, f: NativeFrame): string {
  if (platform === 'android' || f.module) {
    const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : 'Unknown Source'
    return `    at ${f.module ? `${f.module}.` : ''}${f.function ?? '<unknown>'}(${where})`
  }
  const fn = f.function ?? f.symbol
  const location = f.file
    ? `${f.file}${f.line ? `:${f.line}` : ''}`
    : `${f.image ?? '???'}${f.image_offset !== undefined ? ` + 0x${f.image_offset.toString(16)}` : ''}`
  return fn ? `    at ${fn} (${location})` : `    at ${location}`
}

/** The whole exception as text, for the `stack` column and the copy button. */
export function renderNativeStack(platform: NativePlatform, type: string, message: string, exception: NativeException): string {
  const lines = [`${type}: ${message}`.trim()]
  for (const f of exception.frames)
    lines.push(renderFrame(platform, f))
  for (const c of exception.causes ?? []) {
    lines.push(`Caused by: ${c.type}${c.value ? `: ${c.value}` : ''}`)
    for (const f of c.frames)
      lines.push(renderFrame(platform, f))
  }
  return lines.join('\n')
}

/** A symbol lookup for one Apple image: `offset` in, function and line out. */
export type AppleResolver = (uuid: string, offset: number) => { function: string, file?: string, line?: number } | null

/**
 * Fill in function names and lines for Apple frames that have a symbol map.
 *
 * Every frame but the first holds a RETURN address, the instruction after the
 * call. Looking that up as-is can land on the next line, or past the end of a
 * function whose last instruction is the call, so those frames are looked up at
 * `offset - 1`, the way atos and every crash reporter does.
 */
export function symbolicateAppleFrames(frames: NativeFrame[], resolve: AppleResolver): { frames: NativeFrame[], symbolicated: number } {
  let symbolicated = 0
  const out = frames.map((f, i) => {
    if (!f.image_uuid || f.image_offset === undefined)
      return f
    const hit = resolve(f.image_uuid, i === 0 ? f.image_offset : Math.max(0, f.image_offset - 1))
    if (!hit)
      return f
    symbolicated++
    return { ...f, function: hit.function, file: hit.file ?? f.file, line: hit.line ?? f.line }
  })
  return { frames: out, symbolicated }
}

/**
 * The issue list's "where": the first in-app frame of the exception the
 * fingerprint was taken from, without the `at` prefix.
 */
export function nativeCulprit(platform: NativePlatform, exception: NativeException): string | null {
  const chain = [exception.frames, ...(exception.causes ?? []).map(c => c.frames)]
  let frames = chain[0]
  for (const link of chain) {
    if (link.some(f => f.in_app))
      frames = link
  }
  const frame = frames.find(f => f.in_app) ?? frames[0]
  if (!frame)
    return null
  return renderFrame(platform, frame).replace(/^\s+at\s+/, '').slice(0, 240)
}
