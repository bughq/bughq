/**
 * JavaScript sourcemaps: turning a minified frame (`app.js:1:48213`) back into
 * the file, line and function the developer wrote.
 *
 * A bundler writes `app.js.map` beside `app.js`. The map is JSON, and the part
 * that matters is `mappings`: one `;`-separated group per generated line, each
 * a `,`-separated list of segments, each segment one to five base64 VLQ numbers:
 *
 *     generated column, source index, original line, original column, name index
 *
 * Every number but the first is a delta from the previous segment (the
 * generated column resets on each new line, the other four never do), which is
 * why the whole string has to be walked once from the start.
 *
 * Decoded here rather than with a library: the format is small and frozen
 * (Source Map revision 3), and the ingest only ever asks one question of it,
 * "what was at this line and column".
 *
 * Everything in this file is pure. Loading and caching the maps is
 * app/Symbols/store.ts; see tests/unit/sourcemap.test.ts.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_VALUE = new Int8Array(128).fill(-1)
for (let i = 0; i < B64.length; i++)
  B64_VALUE[B64.charCodeAt(i)] = i

/** Fields per stored segment: generated column, source, line, column, name. */
const FIELDS = 5

/**
 * Decode one run of base64 VLQ numbers (a single segment, or any string
 * without separators). Each base64 digit carries five bits of value and a
 * continuation bit; the lowest bit of the assembled number is its sign.
 */
export function decodeVlq(text: string): number[] {
  const out: number[] = []
  let value = 0
  let shift = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const digit = code < 128 ? B64_VALUE[code] : -1
    if (digit < 0)
      throw new Error(`invalid base64 VLQ digit "${text[i]}"`)
    // Multiplication, not `<<`: a shift past 31 bits would wrap silently.
    value += (digit & 31) * 2 ** shift
    if (digit & 32) {
      shift += 5
      continue
    }
    out.push(value % 2 === 1 ? -((value - 1) / 2) : value / 2)
    value = 0
    shift = 0
  }
  if (shift !== 0)
    throw new Error('truncated base64 VLQ')
  return out
}

export interface SourceMapIndex {
  sources: string[]
  names: string[]
  /**
   * One entry per generated line (0-based). Each is a flat run of FIELDS
   * integers per segment, sorted by generated column. A source of -1 marks a
   * stretch of generated code that maps to nothing; a name of -1 means the
   * segment names no identifier.
   */
  lines: Int32Array[]
  /**
   * `sourcesContent`: each source's original text, when the bundler embedded
   * it. Used to read a function's name where the map recorded none.
   */
  contents: Array<string | null>
  /** `contents` split into lines, filled in as sources are first read. */
  contentLines: Map<number, string[]>
}

export interface OriginalPosition {
  source: string
  /** 1-based, as an editor and a stack trace count it. */
  line: number
  /** 1-based. */
  column: number
  /** The original identifier at this position, when the map recorded one. */
  name?: string
}

const EMPTY = new Int32Array(0)

/** Walk a `mappings` string into per-line segment arrays. */
function decodeMappings(mappings: string): Int32Array[] {
  const lines: Int32Array[] = []
  let current: number[] = []
  let genCol = 0
  let source = 0
  let line = 0
  let column = 0
  let name = 0
  let sorted = true
  let start = 0

  const flushLine = () => {
    if (!sorted) {
      // Rare, but the spec does not promise order and one bundler used to
      // emit segments out of it. A binary search needs them sorted.
      const tuples: number[][] = []
      for (let i = 0; i < current.length; i += FIELDS)
        tuples.push(current.slice(i, i + FIELDS))
      tuples.sort((a, b) => a[0] - b[0])
      current = tuples.flat()
    }
    lines.push(current.length ? Int32Array.from(current) : EMPTY)
    current = []
    genCol = 0
    sorted = true
  }

  for (let i = 0; i <= mappings.length; i++) {
    const ch = i < mappings.length ? mappings.charCodeAt(i) : 59 // a final ';'
    if (ch !== 44 && ch !== 59) // ',' and ';'
      continue
    if (i > start) {
      const seg = decodeVlq(mappings.slice(start, i))
      const previous = genCol
      genCol += seg[0]
      if (current.length && genCol < previous)
        sorted = false
      if (seg.length >= 4) {
        source += seg[1]
        line += seg[2]
        column += seg[3]
        if (seg.length >= 5)
          name += seg[4]
        current.push(genCol, source, line, column, seg.length >= 5 ? name : -1)
      }
      else {
        current.push(genCol, -1, 0, 0, -1)
      }
    }
    start = i + 1
    if (ch === 59)
      flushLine()
  }
  // The loop's synthetic final ';' always adds one line; a map whose last real
  // line is empty would otherwise gain a phantom, which is harmless.
  return lines
}

/**
 * Make a `sources` entry readable: apply `sourceRoot`, drop the `./` and `../`
 * a bundler writes relative to its output directory. Scheme prefixes such as
 * `webpack://` are kept; the issue page already knows how to shorten those.
 */
function cleanSource(source: unknown, root: string): string {
  let s = String(source ?? '')
  if (root && !/^(?:[a-z][\w+.-]*:|\/)/i.test(s))
    s = `${root.replace(/\/+$/, '')}/${s}`
  s = s.replace(/\\/g, '/')
  while (s.startsWith('./') || s.startsWith('../'))
    s = s.slice(s.indexOf('/') + 1)
  return s
}

interface RawSourceMap {
  version?: unknown
  sources?: unknown
  names?: unknown
  mappings?: unknown
  sourceRoot?: unknown
  sourcesContent?: unknown
  sections?: unknown
}

function indexFlatMap(raw: RawSourceMap): SourceMapIndex | null {
  if (typeof raw.mappings !== 'string' || !Array.isArray(raw.sources))
    return null
  const root = typeof raw.sourceRoot === 'string' ? raw.sourceRoot : ''
  return {
    sources: raw.sources.map(s => cleanSource(s, root)),
    names: Array.isArray(raw.names) ? raw.names.map(String) : [],
    lines: decodeMappings(raw.mappings),
    contents: raw.sources.map((_, i) => {
      const text = Array.isArray(raw.sourcesContent) ? raw.sourcesContent[i] : null
      return typeof text === 'string' ? text : null
    }),
    contentLines: new Map(),
  }
}

/**
 * An index map: `sections`, each a whole map placed at a line and column of
 * the generated file. Concatenating bundles produces these. Flattened into one
 * index by shifting each section's positions and its source and name indexes.
 */
function indexSections(sections: unknown[]): SourceMapIndex | null {
  const out: SourceMapIndex = { sources: [], names: [], lines: [], contents: [], contentLines: new Map() }
  let any = false
  for (const section of sections) {
    if (!section || typeof section !== 'object')
      continue
    const s = section as { offset?: { line?: unknown, column?: unknown }, map?: unknown }
    const sub = s.map && typeof s.map === 'object' ? indexRaw(s.map as RawSourceMap) : null
    if (!sub)
      continue // a section that only names a `url` cannot be read from here
    any = true
    const lineOffset = Math.max(0, Number(s.offset?.line) || 0)
    const columnOffset = Math.max(0, Number(s.offset?.column) || 0)
    const sourceBase = out.sources.length
    const nameBase = out.names.length
    out.sources.push(...sub.sources)
    out.contents.push(...sub.contents)
    out.names.push(...sub.names)
    sub.lines.forEach((segments, i) => {
      if (!segments.length)
        return
      const shifted = Int32Array.from(segments)
      for (let k = 0; k < shifted.length; k += FIELDS) {
        // Only the section's first line is offset by a column; later lines
        // start at column 0 of the generated file.
        if (i === 0)
          shifted[k] += columnOffset
        if (shifted[k + 1] >= 0)
          shifted[k + 1] += sourceBase
        if (shifted[k + 4] >= 0)
          shifted[k + 4] += nameBase
      }
      const at = lineOffset + i
      while (out.lines.length <= at)
        out.lines.push(EMPTY)
      const existing = out.lines[at]
      if (existing.length) {
        const joined = new Int32Array(existing.length + shifted.length)
        joined.set(existing)
        joined.set(shifted, existing.length)
        out.lines[at] = joined
      }
      else {
        out.lines[at] = shifted
      }
    })
  }
  return any ? out : null
}

function indexRaw(raw: RawSourceMap): SourceMapIndex | null {
  if (Array.isArray(raw.sections))
    return indexSections(raw.sections)
  return indexFlatMap(raw)
}

/**
 * Parse a sourcemap (the JSON text or the parsed object). Returns null for
 * anything that is not a readable revision 3 map, including one with no
 * mappings at all, so an upload of the wrong file is refused rather than
 * stored as a map that resolves nothing.
 */
export function parseSourceMap(input: string | object): SourceMapIndex | null {
  let raw: RawSourceMap
  try {
    // Some servers prefix JSON with `)]}'` to defeat script inclusion.
    raw = typeof input === 'string' ? JSON.parse(input.replace(/^\)\]\}'[^\n]*\n/, '')) : input as RawSourceMap
  }
  catch {
    return null
  }
  if (!raw || typeof raw !== 'object')
    return null
  if (raw.version !== undefined && Number(raw.version) !== 3)
    return null
  try {
    const index = indexRaw(raw)
    return index && index.lines.some(l => l.length) ? index : null
  }
  catch {
    return null
  }
}

const KEYWORDS = new Set(['return', 'throw', 'typeof', 'void', 'delete', 'yield', 'in', 'of', 'instanceof', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'function', 'class', 'const', 'let', 'var', 'this', 'super', 'null', 'true', 'false', 'undefined', 'import', 'export', 'default', 'try', 'catch', 'finally'])

/**
 * The identifier written at a position of an original source, read from the
 * embedded source text. For a call such as `await this.cart.totalFor(items)`
 * that is the last name of the chain, `totalFor`: the function being entered.
 *
 * Bun's bundler, among others, writes maps with an empty `names` list, so
 * without this a minified build would keep names like `n` and `i`, which
 * change with every build and would split one bug across releases.
 */
function identifierAt(map: SourceMapIndex, source: number, line: number, column: number): string | undefined {
  const text = map.contents[source]
  if (!text)
    return undefined
  let lines = map.contentLines.get(source)
  if (!lines) {
    lines = text.split('\n')
    map.contentLines.set(source, lines)
  }
  let rest = (lines[line] ?? '').slice(column)
  let last: string | undefined
  for (;;) {
    const m = rest.match(/^(?:(?:new|await)\s+)*([A-Za-z_$][\w$]*)/)
    if (!m)
      break
    if (KEYWORDS.has(m[1])) {
      // `this.render()` and `super.render()` still name their method.
      if (m[1] !== 'this' && m[1] !== 'super')
        return undefined
    }
    else {
      last = m[1]
    }
    const next = rest.slice(m[0].length).match(/^\s*(?:\?\.|\.)\s*#?/)
    if (!next)
      break
    rest = rest.slice(m[0].length + next[0].length)
  }
  return last
}

/**
 * Look up a generated position. `line` and `column` are 1-based, the way V8,
 * JavaScriptCore and Bun print them in a stack. Returns the segment at or
 * before the column on that line, which is how every consumer reads a map: a
 * segment covers the generated code up to the next segment.
 */
export function originalPosition(map: SourceMapIndex, line: number, column: number): OriginalPosition | null {
  const segments = map.lines[line - 1]
  if (!segments || !segments.length)
    return null
  const target = Math.max(0, column - 1)
  let lo = 0
  let hi = segments.length / FIELDS - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid * FIELDS] <= target) {
      found = mid
      lo = mid + 1
    }
    else {
      hi = mid - 1
    }
  }
  if (found < 0)
    return null
  const at = found * FIELDS
  const source = segments[at + 1]
  if (source < 0 || source >= map.sources.length)
    return null
  const name = segments[at + 4]
  return {
    source: map.sources[source],
    line: segments[at + 2] + 1,
    column: segments[at + 3] + 1,
    name: name >= 0 && name < map.names.length
      ? map.names[name]
      : identifierAt(map, source, segments[at + 2], segments[at + 3]),
  }
}

// ---------------------------------------------------------------------------
// Stack text
// ---------------------------------------------------------------------------

export interface JsFrame {
  /** The function as the runtime printed it, possibly minified or empty. */
  function: string
  /** The script, exactly as printed: a URL, a path, a `file://` URL. */
  file: string
  line: number
  column: number
}

const V8_NAMED = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/
const V8_BARE = /^\s*at\s+(?:async\s+)?(\S+):(\d+):(\d+)\s*$/
const WEBKIT = /^\s*([^@]*)@(.+):(\d+):(\d+)\s*$/
const BARE = /^\s*(\S*[/\\]\S*|\S+\.[cm]?js\S*):(\d+):(\d+)\s*$/

/**
 * Read one line of a stack as a frame, or null when it is not one.
 *
 *   V8, Bun, WebView2:      `    at render (https://app/app.js:1:234)`
 *                           `    at https://app/app.js:1:234`
 *   WKWebView, WebKitGTK:   `render@https://app/app.js:1:234`
 *                           `@https://app/app.js:1:234`, `https://app/app.js:1:234`
 */
export function parseJsFrame(text: string): JsFrame | null {
  let m = text.match(V8_NAMED)
  if (m)
    return { function: m[1], file: m[2], line: Number(m[3]), column: Number(m[4]) }
  m = text.match(V8_BARE)
  if (m)
    return { function: '', file: m[1], line: Number(m[2]), column: Number(m[3]) }
  if (/^\s*at\s/.test(text))
    return null // `at fn (native)`, `at async Promise.all (index 0)`
  m = text.match(WEBKIT)
  if (m)
    return { function: m[1].trim(), file: m[2], line: Number(m[3]), column: Number(m[4]) }
  m = text.match(BARE)
  if (m)
    return { function: '', file: m[1], line: Number(m[2]), column: Number(m[3]) }
  return null
}

/**
 * A script's path with everything that varies between machines removed: the
 * query and fragment, the scheme and host, and Windows separators. What is left
 * (`assets/app.js`, `Users/me/app/dist/agent.js`) is compared by its tail.
 */
export function scriptPath(file: string): string {
  let s = String(file).replace(/[?#].*$/, '').replace(/\\/g, '/')
  s = s.replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, '') // scheme://host
  s = s.replace(/^[a-z]:(?=\/)/i, '') // a Windows drive letter
  s = s.replace(/^~\//, '')
  return s.replace(/^\/+/, '')
}

/**
 * Which uploaded map belongs to a frame's script. A map is uploaded under the
 * script's name as the build knows it (`app.js`, `assets/app.js`), and a frame
 * names it as the runtime loaded it (`https://fettler.localhost/assets/app.js`,
 * `/Applications/Fettler.app/Contents/Resources/agent.js`), so the upload name
 * matches when it is the whole path or its tail on a `/` boundary. The longest
 * match wins, so `assets/app.js` beats a second bundle's `app.js`.
 */
export function matchScript(names: string[], file: string): string | null {
  const path = scriptPath(file)
  if (!path)
    return null
  let best: string | null = null
  let bestLength = -1
  for (const name of names) {
    const want = scriptPath(name)
    if (!want || want.length <= bestLength)
      continue
    if (path === want || path.endsWith(`/${want}`)) {
      best = name
      bestLength = want.length
    }
  }
  return best
}

/** The distinct scripts a stack names, for loading their maps before the rewrite. */
export function jsStackFiles(stack: string): string[] {
  const files = new Set<string>()
  for (const line of String(stack || '').split('\n')) {
    const frame = parseJsFrame(line)
    if (frame)
      files.add(frame.file)
  }
  return [...files]
}

/** Scripts no build could have a map for: the runtime's own. */
function isRuntimeScript(file: string): boolean {
  return /^(?:node:|bun:|internal[:/]|native\b|\[native code\]|<anonymous>|eval\b)/.test(file)
}

function cleanFunctionName(name: string): string {
  return name.replace(/^(?:async|new)\s+/, '').replace(/\s+\[as [^\]]+\]$/, '').trim()
}

export interface JsSymbolication {
  stack: string
  /** Frames rewritten to their original position. */
  symbolicated: number
  /** Scripts in the stack that had no map, runtime internals excluded. */
  missing: string[]
}

/**
 * Rewrite every frame of a stack that has a map. `resolve` is given the script
 * exactly as the frame names it and returns its parsed map, or null.
 *
 * Resolved frames are written in the V8 shape (`    at fn (file:line:col)`)
 * whatever engine produced them, so a WKWebView stack and a WebView2 stack of
 * the same fault read, group and render the same afterwards. Lines that are
 * not frames, and frames without a map, are left exactly as they came.
 *
 * Function names: a map records the original name of the identifier at a
 * position, not of the function around it. The position of a frame's CALLER is
 * the call expression that entered the frame, so the name found there is the
 * frame's own function. That is the name used; without one (the bottom frame,
 * or a callback entered from native code), the name the runtime printed is
 * kept, which is still right for unminified names.
 */
export function symbolicateJsStack(stack: string, resolve: (file: string) => SourceMapIndex | null): JsSymbolication {
  const lines = String(stack || '').split('\n')
  const frames = lines.map(parseJsFrame)
  const positions = frames.map((frame) => {
    if (!frame)
      return null
    const map = resolve(frame.file)
    return map ? originalPosition(map, frame.line, frame.column) : null
  })

  const missing = new Set<string>()
  let symbolicated = 0
  const out = lines.map((line, i) => {
    const frame = frames[i]
    if (!frame)
      return line
    const position = positions[i]
    if (!position) {
      // Only built JavaScript can be missing a map. A `.ts` frame is a dev
      // run straight from source and already reads the way it was written.
      const script = scriptPath(frame.file)
      if (!isRuntimeScript(frame.file) && /\.[cm]?js$/i.test(script) && resolve(frame.file) === null)
        missing.add(script.split('/').pop() as string)
      return line
    }
    symbolicated++
    // Only the very next line counts as the caller. When a native frame sits
    // between (`at Array.map (<anonymous>)`), the frame below it called `map`,
    // not this callback, and its name would be the wrong one.
    const caller = frames[i + 1] ? positions[i + 1] : null
    const printed = cleanFunctionName(frame.function)
    const anonymous = !printed || /^(?:<anonymous>|anonymous|global code|module code|eval code)$/i.test(printed)
    const name = anonymous ? '' : (caller?.name ?? printed)
    const where = `${position.source}:${position.line}:${position.column}`
    return name ? `    at ${name} (${where})` : `    at ${where}`
  })
  return { stack: out.join('\n'), symbolicated, missing: [...missing] }
}
