/**
 * R8 / ProGuard retrace: turning an obfuscated Android frame back into the
 * class, method and line the developer wrote.
 *
 * A release build minified by R8 throws `at a.b.c(SourceFile:12)`. The build
 * writes `mapping.txt` alongside the bundle, and that file is all retrace needs:
 *
 *     com.example.Player -> a.b:
 *     # {"id":"sourceFile","fileName":"Player.kt"}
 *         int count -> a
 *         1:4:void start(java.lang.String):30:33 -> c
 *         5:5:void com.example.Clock.tick():12:12 -> c
 *         5:5:void start(java.lang.String):34 -> c
 *
 * A method row says: obfuscated lines 1-4 of method `c` are original lines
 * 30-33 of `start`. Several rows sharing one obfuscated range are an inline
 * stack, innermost first, which is why one obfuscated frame can retrace to more
 * than one original frame.
 *
 * Parsed in TypeScript on the server: the format is plain text, and keeping it
 * here means the build only uploads the file Gradle already wrote.
 */

export interface ProguardMapping {
  /** Obfuscated class name to its entry. */
  classes: Map<string, ProguardClass>
  /** Original class name to its entry, for inlined frames that name another class. */
  byOriginal: Map<string, ProguardClass>
}

export interface ProguardClass {
  original: string
  sourceFile?: string
  /** Obfuscated method name to its rows, in file order. */
  methods: Map<string, ProguardMethodRow[]>
}

export interface ProguardMethodRow {
  /** Obfuscated line range, or null for a row without line info. */
  obfStart: number | null
  obfEnd: number | null
  /** Original method name, possibly qualified with another class when inlined. */
  name: string
  origStart: number | null
  origEnd: number | null
}

export interface RetracedFrame {
  module: string
  function: string
  file?: string
  line?: number
}

const CLASS_ROW = /^(\S.*?) -> (\S+):$/
// [a:b:]return name(args)[:c[:d]] -> obf
const METHOD_ROW = /^\s+(?:(\d+):(\d+):)?(\S+) ([^\s(]+)\(([^)]*)\)(?::(\d+)(?::(\d+))?)? -> (\S+)$/

export function parseMapping(text: string): ProguardMapping {
  const classes = new Map<string, ProguardClass>()
  const byOriginal = new Map<string, ProguardClass>()
  let current: ProguardClass | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line)
      continue
    if (line.startsWith('#')) {
      // Class-level R8 metadata: the original source file name.
      if (current && line.includes('"sourceFile"')) {
        const m = line.match(/"fileName"\s*:\s*"([^"]+)"/)
        if (m)
          current.sourceFile = m[1]
      }
      continue
    }
    const cls = line.match(CLASS_ROW)
    if (cls) {
      current = { original: cls[1], methods: new Map() }
      classes.set(cls[2], current)
      byOriginal.set(cls[1], current)
      continue
    }
    if (!current)
      continue
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#')) {
      continue
    }
    const m = line.match(METHOD_ROW)
    if (!m)
      continue // a field row, or something this parser does not need
    const [, obfStart, obfEnd, , name, , origStart, origEnd, obf] = m
    const row: ProguardMethodRow = {
      obfStart: obfStart ? Number(obfStart) : null,
      obfEnd: obfEnd ? Number(obfEnd) : null,
      name,
      origStart: origStart ? Number(origStart) : null,
      origEnd: origEnd ? Number(origEnd) : null,
    }
    const rows = current.methods.get(obf)
    if (rows)
      rows.push(row)
    else
      current.methods.set(obf, [row])
  }
  return { classes, byOriginal }
}

function sourceFileFor(className: string, given?: string): string {
  if (given)
    return given
  const simple = className.slice(className.lastIndexOf('.') + 1).split('$')[0]
  return `${simple}.java`
}

function splitQualified(name: string, owner: string): { module: string, method: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0)
    return { module: owner, method: name }
  return { module: name.slice(0, dot), method: name.slice(dot + 1) }
}

/**
 * Retrace one frame. Returns the frame unchanged (as a single element) when
 * the class is not in the mapping, which is the normal case for framework
 * frames: R8 does not rename `android.*` or `java.*`.
 */
export function retraceFrame(mapping: ProguardMapping, frame: { module: string, function: string, file?: string, line?: number }): RetracedFrame[] {
  const cls = mapping.classes.get(frame.module)
  if (!cls)
    return [{ module: frame.module, function: frame.function, file: frame.file, line: frame.line }]
  const rows = cls.methods.get(frame.function) ?? []
  const line = typeof frame.line === 'number' && frame.line > 0 ? frame.line : null

  // Rows whose obfuscated range covers the line, in file order (innermost
  // inlined frame first). Without a line, fall back to rows with no range, and
  // then to every row when the name alone is unambiguous.
  let matches = line !== null
    ? rows.filter(r => r.obfStart !== null && r.obfEnd !== null && line >= r.obfStart && line <= r.obfEnd)
    : []
  if (!matches.length)
    matches = rows.filter(r => r.obfStart === null)
  if (!matches.length) {
    const names = new Set(rows.map(r => r.name))
    if (names.size === 1)
      matches = [rows[0]]
  }
  if (!matches.length)
    return [{ module: cls.original, function: frame.function, file: sourceFileFor(cls.original, cls.sourceFile), line: frame.line }]

  return matches.map((r) => {
    const { module, method } = splitQualified(r.name, cls.original)
    let original: number | undefined
    if (r.origStart !== null) {
      // A range row maps line-for-line; a single original line means every
      // obfuscated line in the range came from that one line (inlined call).
      if (line !== null && r.obfStart !== null && r.origEnd !== null && r.origEnd !== r.origStart)
        original = r.origStart + (line - r.obfStart)
      else
        original = r.origStart
    }
    else if (line !== null && r.obfStart === null) {
      original = line
    }
    const inlinedOwner = mapping.byOriginal.get(module)
    return {
      module,
      function: method,
      file: module === cls.original ? sourceFileFor(module, cls.sourceFile) : sourceFileFor(module, inlinedOwner?.sourceFile),
      line: original,
    }
  })
}

/** Retrace a whole frame list, expanding inlined frames in place. */
export function retraceFrames(mapping: ProguardMapping, frames: Array<{ module?: string, function?: string, file?: string, line?: number, in_app?: boolean }>): Array<{ module?: string, function?: string, file?: string, line?: number, in_app?: boolean }> {
  const out: Array<{ module?: string, function?: string, file?: string, line?: number, in_app?: boolean }> = []
  for (const f of frames) {
    if (!f.module || !f.function) {
      out.push(f)
      continue
    }
    for (const r of retraceFrame(mapping, { module: f.module, function: f.function, file: f.file, line: f.line }))
      out.push({ ...f, ...r })
  }
  return out
}

/** Deobfuscate class names inside a message such as `a.b cannot be cast to a.c`. */
export function retraceClassNames(mapping: ProguardMapping, text: string): string {
  return String(text).replace(/\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+\b/g, name => mapping.classes.get(name)?.original ?? name)
}
