import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fingerprintFromParts } from '../../app/Errors/fingerprint'
import {
  frameKey,
  isJvmInApp,
  nativeCulprit,
  nativeFingerprintParts,
  parseNativeException,
  renderNativeStack,
  symbolicateAppleFrames,
} from '../../app/Errors/native'
import { buildMetadata } from '../../app/Errors/payload'
import { displayPrefix, generateUploadToken, hashUploadToken, tokenFromAuthorization, UPLOAD_TOKEN_PREFIX } from '../../app/Errors/uploadTokens'
import { crashFreeRate, escalate, ESCALATE_SQL, parseSessions } from '../../app/Releases/health'
import { lookupSymbol, normalizeUuid, packSymbolMap, parseSymbolsOutput, unpackSymbolMap } from '../../app/Symbols/apple'
import { parseMapping, retraceClassNames, retraceFrame, retraceFrames } from '../../app/Symbols/proguard'

// Real `symbols -arch arm64` output for a tiny Swift program (see the fixture):
// Player.start(_:) force-unwraps a nil Optional on line 4.
const SYMBOLS = readFileSync(resolve(import.meta.dir, '../fixtures/apple-symbols.txt'), 'utf8')
const UUID = 'F47C8145-F263-379D-9AD1-F3485CB38B7F'

describe('apple symbol maps', () => {
  const [map] = parseSymbolsOutput(SYMBOLS)

  test('reads the binary, its uuid and only code from __TEXT', () => {
    expect(map.uuid).toBe(UUID)
    expect(map.image).toBe('t')
    expect(map.arch).toBe('arm64')
    const names = map.functions.map(f => f.name)
    expect(names).toContain('Player.start(_:)')
    expect(names).toContain('runIt()')
    // Data symbols (nominal type descriptors) are not functions.
    expect(names.some(n => n.startsWith('nominal type descriptor'))).toBe(false)
  })

  test('resolves an offset to the function and its source line', () => {
    expect(lookupSymbol(map, 0xAC0)).toEqual({ function: 'Player.start(_:)', file: 't.swift', line: 4 })
    expect(lookupSymbol(map, 0xB34)).toEqual({ function: 'Player.start(_:)', file: 't.swift', line: 5 })
  })

  test('a gap of compiler-generated code takes the line before it, not :0', () => {
    // 0xab4..0xac0 is `t.swift:0` in the dump.
    expect(lookupSymbol(map, 0xAB8)?.line).toBe(3)
  })

  test('misses outside every function', () => {
    expect(lookupSymbol(map, 0x10)).toBeNull()
    expect(lookupSymbol(map, 0x100000)).toBeNull()
  })

  test('survives the stored round trip', () => {
    const back = unpackSymbolMap(packSymbolMap(map))
    expect(back.uuid).toBe(UUID)
    expect(back.functions.length).toBe(map.functions.length)
    expect(lookupSymbol(back, 0xAC0)).toEqual(lookupSymbol(map, 0xAC0))
  })

  test('normalises uuid spellings', () => {
    expect(normalizeUuid('f47c8145f263379d9ad1f3485cb38b7f')).toBe(UUID)
    expect(normalizeUuid(UUID.toLowerCase())).toBe(UUID)
  })

  test('symbolicates every frame but the crashing one at the return address minus one', () => {
    const seen: number[] = []
    symbolicateAppleFrames([
      { image: 't', image_uuid: UUID, image_offset: 0xAC0 },
      { image: 't', image_uuid: UUID, image_offset: 0x974 },
    ], (_uuid, offset) => {
      seen.push(offset)
      return null
    })
    expect(seen).toEqual([0xAC0, 0x973])
  })
})

const MAPPING = `# compiler: R8
# pg_map_id: 1a2b3c
training.hq.app.Player -> a.b:
# {"id":"sourceFile","fileName":"Player.kt"}
    int count -> a
    1:4:void start(java.lang.String):30:33 -> c
    5:5:void training.hq.app.Clock.tick():12:12 -> c
    5:5:void start(java.lang.String):34 -> c
    void stop() -> d
training.hq.app.Clock -> a.c:
# {"id":"sourceFile","fileName":"Clock.kt"}
    1:1:void tick():12:12 -> a
`

describe('proguard retrace', () => {
  const mapping = parseMapping(MAPPING)

  test('maps class, method and line ranges', () => {
    expect(retraceFrame(mapping, { module: 'a.b', function: 'c', line: 2 }))
      .toEqual([{ module: 'training.hq.app.Player', function: 'start', file: 'Player.kt', line: 31 }])
  })

  test('expands an inlined frame into the inline stack, innermost first', () => {
    expect(retraceFrame(mapping, { module: 'a.b', function: 'c', line: 5 })).toEqual([
      { module: 'training.hq.app.Clock', function: 'tick', file: 'Clock.kt', line: 12 },
      { module: 'training.hq.app.Player', function: 'start', file: 'Player.kt', line: 34 },
    ])
  })

  test('leaves framework frames alone', () => {
    expect(retraceFrame(mapping, { module: 'android.os.Handler', function: 'dispatchMessage', file: 'Handler.java', line: 102 }))
      .toEqual([{ module: 'android.os.Handler', function: 'dispatchMessage', file: 'Handler.java', line: 102 }])
  })

  test('retraces a frame list and class names in messages', () => {
    const out = retraceFrames(mapping, [{ module: 'a.b', function: 'd', in_app: true }])
    expect(out[0]).toMatchObject({ module: 'training.hq.app.Player', function: 'stop', in_app: true })
    expect(retraceClassNames(mapping, 'a.b cannot be cast to a.c')).toBe('training.hq.app.Player cannot be cast to training.hq.app.Clock')
  })
})

describe('native grouping', () => {
  const crash = parseNativeException({
    mechanism: 'signal',
    signal: 'SIGSEGV',
    frames: [
      { image: 'libsystem_platform.dylib', image_offset: 100, in_app: false },
      { image: 'HQTraining', image_uuid: UUID, image_offset: 0xAC0, function: 'Player.start(_:)', file: 'Player.swift', line: 4, in_app: true },
      { image: 'HQTraining', image_uuid: UUID, image_offset: 0x974, function: 'runIt()', file: 'main.swift', line: 8, in_app: true },
    ],
  })!

  test('validates the wire block and drops junk frames', () => {
    expect(parseNativeException(null)).toBeNull()
    expect(parseNativeException({ frames: [] })).toBeNull()
    const parsed = parseNativeException({ mechanism: 'x', frames: [{}, 'nope', { image: 'A', image_offset: '0x10' }] })!
    expect(parsed.frames).toEqual([{ image: 'A', image_offset: 16 } as any])
  })

  test('groups on type plus the top in-app frames, never on the message or lines', () => {
    const parts = nativeFingerprintParts('ios', 'SIGSEGV', crash)
    expect(parts).toEqual(['native', 'ios', 'SIGSEGV', 'Player.start(_:)', 'runIt()'])

    const movedLines = parseNativeException({
      ...crash,
      frames: crash.frames.map(f => ({ ...f, line: (f.line ?? 0) + 7, image_offset: (f.image_offset ?? 0) + 64 })),
    })!
    expect(fingerprintFromParts(nativeFingerprintParts('ios', 'SIGSEGV', movedLines)!))
      .toBe(fingerprintFromParts(parts!))
  })

  test('unsymbolicated frames group by image and offset', () => {
    expect(frameKey({ image: 'HQTraining', image_offset: 0xAC0 })).toBe('HQTraining+0xac0')
  })

  test('a JVM wrapper groups by the cause that holds the app frames', () => {
    const wrapped = parseNativeException({
      mechanism: 'uncaught',
      frames: [{ module: 'android.os.Looper', function: 'loop', in_app: false }],
      causes: [{ type: 'java.lang.IllegalStateException', value: 'no workout', frames: [
        { module: 'training.hq.app.Player', function: 'start', file: 'Player.kt', line: 31, in_app: true },
      ] }],
    })!
    expect(nativeFingerprintParts('android', 'java.lang.RuntimeException', wrapped))
      .toEqual(['native', 'android', 'java.lang.IllegalStateException', 'training.hq.app.Player.start'])
    expect(nativeCulprit('android', wrapped)).toBe('training.hq.app.Player.start(Player.kt:31)')
  })

  test('renders a readable stack for both platforms', () => {
    const text = renderNativeStack('ios', 'SIGSEGV', 'EXC_BAD_ACCESS', crash)
    expect(text.split('\n')[0]).toBe('SIGSEGV: EXC_BAD_ACCESS')
    expect(text).toContain('    at Player.start(_:) (Player.swift:4)')
    expect(text).toContain('    at libsystem_platform.dylib + 0x64')
    expect(nativeCulprit('ios', crash)).toBe('Player.start(_:) (Player.swift:4)')
  })

  test('judges JVM frames as in-app by package', () => {
    expect(isJvmInApp('training.hq.app.Player', 'training.hq.app')).toBe(true)
    expect(isJvmInApp('androidx.fragment.app.Fragment', 'training.hq.app')).toBe(false)
    expect(isJvmInApp('kotlin.collections.ArraysKt', undefined)).toBe(false)
  })

  test('keeps the frames when metadata is over the cap', () => {
    const meta = JSON.parse(buildMetadata({
      platform: 'ios',
      exception: crash,
      breadcrumbs: Array.from({ length: 100 }, () => ({ message: 'x'.repeat(1200) })),
    })!)
    expect(meta._truncated).toBeTruthy()
    expect(meta.exception.frames.length).toBe(3)
    expect(meta.platform).toBe('ios')
  })
})

describe('upload tokens', () => {
  test('are prefixed, long, and stored only as a hash', () => {
    const token = generateUploadToken()
    expect(token.startsWith(UPLOAD_TOKEN_PREFIX)).toBe(true)
    expect(token.length).toBe(UPLOAD_TOKEN_PREFIX.length + 40)
    expect(/^[\w]+$/.test(token)).toBe(true)
    expect(hashUploadToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(generateUploadToken()).not.toBe(token)
    expect(displayPrefix(token)).toBe(`${token.slice(0, UPLOAD_TOKEN_PREFIX.length + 6)}…`)
  })

  test('only an upload token is accepted from the header, never an ingest key', () => {
    expect(tokenFromAuthorization('Bearer bughq_up_abc')).toBe('bughq_up_abc')
    expect(tokenFromAuthorization('Bearer bughq_0123')).toBeNull()
    expect(tokenFromAuthorization(null)).toBeNull()
  })
})

describe('release health', () => {
  test('status only escalates', () => {
    expect(escalate('crashed', 'ok')).toBe('crashed')
    expect(escalate('ok', 'errored')).toBe('errored')
    expect(escalate('abnormal', 'errored')).toBe('abnormal')
  })

  test('the SQL upsert escalates in the same order', () => {
    const order = [...ESCALATE_SQL.matchAll(/= '(\w+)'/g)].map(m => m[1])
    expect([...new Set(order)]).toEqual(['crashed', 'abnormal', 'errored'])
  })

  test('crash-free rounds down, so a crash never shows as 100%', () => {
    expect(crashFreeRate(0, 0)).toBeNull()
    expect(crashFreeRate(4, 1)).toBe(75)
    expect(crashFreeRate(100_000, 1)).toBe(99.99)
    expect(crashFreeRate(10, 0)).toBe(100)
  })

  test('parses a replayed queue and skips malformed sessions', () => {
    const now = new Date('2026-10-14T12:00:00Z')
    const out = parseSessions({
      release: '1.0.0+41',
      sessions: [
        { id: 'abcd1234-ok', status: 'ok', started_at: '2026-10-14T11:00:00Z' },
        { id: 'short' },
        { id: 'abcd1234-crash', status: 'crashed', release: '1.0.0+40', started_at: '2099-01-01T00:00:00Z', user_id: 967 },
        { id: 'abcd1234-weird', status: 'exploded' },
      ],
    }, now)
    expect(out.map(s => s.id)).toEqual(['abcd1234-ok', 'abcd1234-crash', 'abcd1234-weird'])
    expect(out[0].release).toBe('1.0.0+41')
    expect(out[1].release).toBe('1.0.0+40')
    expect(out[1].startedAt).toBe(now.toISOString())
    expect(out[1].userId).toBe('967')
    expect(out[2].status).toBe('ok')
  })
})
