/**
 * Apple symbol maps: turning an iOS crash's `image + offset` frames into
 * function names and source lines.
 *
 * Why a symbol map and not the dSYM itself. bughq runs on Linux, and reading a
 * dSYM well needs two things Linux does not have: a Mach-O/DWARF reader that
 * understands Apple's layout, and the Swift demangler (Swift symbols are
 * mangled, and llvm-symbolizer cannot demangle them). The machine that built the
 * app has both. macOS ships `/usr/bin/symbols`, which reads a dSYM and prints
 * every function with its address range and its source-line ranges, already
 * demangled. So the build (Xcode Cloud's `ci_post_xcodebuild.sh`, or a local
 * archive) pipes `symbols -arch arm64 <dSYM>` through gzip to the upload
 * endpoint, and this file reduces that text to a compact map keyed by the
 * binary's UUID.
 *
 * Offsets in the map are relative to the image's `__TEXT` segment, which is the
 * same base MetricKit's `offsetIntoBinaryTextSegment` uses and what the in-app
 * signal handler computes as `address - image load address`. Lookups are a
 * binary search, so a symbolicated frame costs microseconds once the map is
 * loaded.
 */

/** One binary's symbols, parsed out of `symbols` output or a stored map. */
export interface AppleSymbolMap {
  uuid: string
  /** Binary name (`HQTraining`, not the dSYM path). */
  image: string
  arch: string
  /** Function ranges, sorted by `start`. */
  functions: AppleFunction[]
  /** Source files referenced by `lines`, by index. */
  files: string[]
}

export interface AppleFunction {
  start: number
  size: number
  name: string
  /** Source-line ranges inside the function, sorted by `start`. */
  lines: AppleLine[]
}

export interface AppleLine {
  start: number
  size: number
  file: number
  line: number
}

export interface AppleSymbol {
  function: string
  file?: string
  line?: number
}

const ROW = /^(\s*)0x([0-9a-f]+) \(\s*0x([0-9a-f]+)\) (.*)$/i
const HEADER_UUID = /^\s*([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\s+(\S.*?)\s+\[/i
const ARCH = /^\S.*\[([a-z0-9_]+),[^\]]*\]:\s*$/i

/** Normalise any UUID spelling (`a1b2…`, `A1B2-…`) to the canonical uppercase, dashed form. */
export function normalizeUuid(raw: string): string {
  const hex = String(raw || '').replace(/[^0-9a-f]/gi, '').toUpperCase()
  if (hex.length !== 32)
    return String(raw || '').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

/**
 * Parse the text `/usr/bin/symbols <dSYM>` prints into one map per binary.
 *
 * The output is indentation-structured:
 *
 *     HQTraining.app.dSYM [arm64, 0.01 seconds]:
 *         F47C8145-… /…/DWARF/HQTraining [dSYM_v3, …]
 *             0x0000000100000000 (  0x4000) __TEXT SEGMENT
 *                 0x0000000100000930 (   0x3ac) __TEXT __text
 *                     0x0000000100000a70 (    0xf8) Player.start(_:) [FUNC, …]
 *                         0x0000000100000a70 (    0x44) Player.swift:3
 *
 * Only functions inside `__TEXT` are kept, and a line of `0` (compiler
 * generated code) is dropped so the lookup falls back to the function rather
 * than reporting a meaningless `:0`.
 */
export function parseSymbolsOutput(text: string): AppleSymbolMap[] {
  const maps: AppleSymbolMap[] = []
  let current: AppleSymbolMap | null = null
  let arch = 'arm64'
  let textBase: number | null = null
  let inText = false
  let fn: AppleFunction | null = null
  let fnIndent = -1
  const fileIndex = new Map<string, number>()

  const finish = () => {
    if (current && current.functions.length) {
      current.functions.sort((a, b) => a.start - b.start)
      for (const f of current.functions)
        f.lines.sort((a, b) => a.start - b.start)
      maps.push(current)
    }
    current = null
    textBase = null
    inText = false
    fn = null
    fnIndent = -1
    fileIndex.clear()
  }

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line)
      continue

    const archMatch = line.match(ARCH)
    if (archMatch) {
      finish()
      arch = archMatch[1]
      continue
    }

    const header = line.match(HEADER_UUID)
    if (header) {
      finish()
      current = { uuid: normalizeUuid(header[1]), image: basename(header[2]), arch, functions: [], files: [] }
      continue
    }

    if (!current)
      continue
    const row = line.match(ROW)
    if (!row)
      continue
    const map: AppleSymbolMap = current
    const indent = row[1].length
    const address = Number.parseInt(row[2], 16)
    const size = Number.parseInt(row[3], 16)
    const rest = row[4]

    if (/ SEGMENT$/.test(rest)) {
      inText = rest.startsWith('__TEXT ')
      if (inText)
        textBase = address
      fn = null
      continue
    }
    if (!inText || textBase === null)
      continue
    // A section row: `__TEXT __text`, `__TEXT __stubs`, …
    if (/^__[A-Z_]+ __\w+$/.test(rest)) {
      fn = null
      continue
    }

    // A source-line row under the current function.
    if (fn && indent > fnIndent) {
      const src = rest.match(/^(.*):(\d+)$/)
      if (src) {
        const lineNo = Number(src[2])
        const file = src[1]
        if (lineNo > 0 && !file.includes('<compiler-generated>')) {
          let idx = fileIndex.get(file)
          if (idx === undefined) {
            idx = map.files.length
            map.files.push(file)
            fileIndex.set(file, idx)
          }
          fn.lines.push({ start: address - textBase, size, file: idx, line: lineNo })
        }
      }
      continue
    }

    // A symbol row. Only code (FUNC) is useful for a stack frame.
    const sym = rest.match(/^(.*?) \[([^\]]*)\]\s*$/)
    if (!sym || !/\bFUNC\b/.test(sym[2])) {
      fn = null
      continue
    }
    const name = sym[1].trim()
    if (!name) {
      fn = null
      continue
    }
    fn = { start: address - textBase, size, name, lines: [] }
    fnIndent = indent
    map.functions.push(fn)
  }
  finish()
  return maps
}

/**
 * Serialise a map into the stored form: a small line-based text, gzipped and
 * base64'd by the caller. Line-based rather than JSON because a big app has
 * hundreds of thousands of line rows, and JSON's per-row keys would triple it.
 *
 *     BUGHQSYM 1
 *     uuid F47C8145-…
 *     image HQTraining
 *     arch arm64
 *     file 0 Player.swift
 *     F a70 f8 Player.start(_:)
 *     L a70 44 0 3
 */
export function serializeSymbolMap(map: AppleSymbolMap): string {
  const out: string[] = ['BUGHQSYM 1', `uuid ${map.uuid}`, `image ${map.image}`, `arch ${map.arch}`]
  map.files.forEach((file, i) => out.push(`file ${i} ${file}`))
  for (const fn of map.functions) {
    out.push(`F ${fn.start.toString(16)} ${fn.size.toString(16)} ${fn.name}`)
    for (const l of fn.lines)
      out.push(`L ${l.start.toString(16)} ${l.size.toString(16)} ${l.file} ${l.line}`)
  }
  return out.join('\n')
}

export function deserializeSymbolMap(text: string): AppleSymbolMap {
  const map: AppleSymbolMap = { uuid: '', image: '', arch: 'arm64', functions: [], files: [] }
  let fn: AppleFunction | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('F ')) {
      const a = line.indexOf(' ', 2)
      const b = line.indexOf(' ', a + 1)
      fn = { start: Number.parseInt(line.slice(2, a), 16), size: Number.parseInt(line.slice(a + 1, b), 16), name: line.slice(b + 1), lines: [] }
      map.functions.push(fn)
    }
    else if (line.startsWith('L ') && fn) {
      const [, start, size, file, lineNo] = line.split(' ')
      fn.lines.push({ start: Number.parseInt(start, 16), size: Number.parseInt(size, 16), file: Number(file), line: Number(lineNo) })
    }
    else if (line.startsWith('file ')) {
      const a = line.indexOf(' ', 5)
      map.files[Number(line.slice(5, a))] = line.slice(a + 1)
    }
    else if (line.startsWith('uuid ')) {
      map.uuid = line.slice(5)
    }
    else if (line.startsWith('image ')) {
      map.image = line.slice(6)
    }
    else if (line.startsWith('arch ')) {
      map.arch = line.slice(5)
    }
  }
  return map
}

/** Gzip + base64, the column form. */
export function packSymbolMap(map: AppleSymbolMap): string {
  return Buffer.from(Bun.gzipSync(Buffer.from(serializeSymbolMap(map)))).toString('base64')
}

export function unpackSymbolMap(packed: string): AppleSymbolMap {
  return deserializeSymbolMap(Buffer.from(Bun.gunzipSync(Buffer.from(packed, 'base64'))).toString('utf8'))
}

/**
 * Find the function containing `offset`, and the source line within it.
 *
 * Return addresses point at the instruction AFTER the call, which can belong
 * to the next line or even the next function. Callers pass `offset - 1` for
 * every frame except the crashing one (see symbolicateAppleFrames).
 */
export function lookupSymbol(map: AppleSymbolMap, offset: number): AppleSymbol | null {
  const fns = map.functions
  let lo = 0
  let hi = fns.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (fns[mid].start <= offset) {
      found = mid
      lo = mid + 1
    }
    else {
      hi = mid - 1
    }
  }
  if (found < 0)
    return null
  const fn = fns[found]
  if (offset >= fn.start + Math.max(fn.size, 1))
    return null
  // The line range holding the offset, or failing that the nearest one before
  // it. Gaps between ranges are the `:0` rows dropped at parse time: code the
  // compiler generated for the statement before them, so that line is the
  // honest answer.
  let best: AppleLine | null = null
  for (const l of fn.lines) {
    if (l.start > offset)
      break
    best = l
  }
  if (!best)
    return { function: fn.name }
  return { function: fn.name, file: map.files[best.file], line: best.line }
}
