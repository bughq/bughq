import type { SessionStatus } from '../../app/Releases/health'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fingerprintFromParts } from '../../app/Errors/fingerprint'
import {
  DESKTOP_PLATFORMS,
  isApplePlatform,
  isDesktopPlatform,
  isNativePlatform,
  NATIVE_PLATFORMS,
  nativeCulprit,
  nativeFingerprintParts,
  parseNativeException,
  platformLabel,
  renderNativeStack,
  symbolicateAppleFrames,
} from '../../app/Errors/native'
import { buildMetadata } from '../../app/Errors/payload'
import { crashFreeRate, escalate, parseSessions, sessionFromEvent, withCrashFree } from '../../app/Releases/health'
import { lookupSymbol, parseSymbolsOutput } from '../../app/Symbols/apple'
import { symbolicate } from '../../app/Symbols/store'

const root = resolve(import.meta.dir, '../..')

describe('desktop platforms', () => {
  test('macos, windows and linux are native platforms beside ios and android', () => {
    expect([...NATIVE_PLATFORMS]).toEqual(['ios', 'android', 'macos', 'windows', 'linux'])
    for (const p of ['ios', 'android', 'macos', 'windows', 'linux'])
      expect(isNativePlatform(p)).toBe(true)
  })

  test('nothing else is: a web or server platform never takes the native path', () => {
    for (const p of ['javascript', 'node', 'stacks', 'darwin', 'win32', 'MacOS', 'mac', '', null, undefined, 3, {}])
      expect(isNativePlatform(p)).toBe(false)
  })

  test('the desktop subset excludes the phones', () => {
    expect([...DESKTOP_PLATFORMS]).toEqual(['macos', 'windows', 'linux'])
    expect(isDesktopPlatform('macos')).toBe(true)
    expect(isDesktopPlatform('windows')).toBe(true)
    expect(isDesktopPlatform('linux')).toBe(true)
    expect(isDesktopPlatform('ios')).toBe(false)
    expect(isDesktopPlatform('android')).toBe(false)
  })

  test('macOS shares the Apple symbol path with iOS; Windows and Linux do not', () => {
    expect(isApplePlatform('ios')).toBe(true)
    expect(isApplePlatform('macos')).toBe(true)
    expect(isApplePlatform('windows')).toBe(false)
    expect(isApplePlatform('linux')).toBe(false)
    expect(isApplePlatform('android')).toBe(false)
  })

  test('labels read the way the vendors write them', () => {
    expect(NATIVE_PLATFORMS.map(platformLabel)).toEqual(['iOS', 'Android', 'macOS', 'Windows', 'Linux'])
    expect(platformLabel('javascript')).toBe('javascript')
  })

  test('the stored metadata keeps a desktop platform and drops an unknown one', () => {
    for (const platform of DESKTOP_PLATFORMS)
      expect(JSON.parse(buildMetadata({ platform, tags: { a: 1 } }) as string).platform).toBe(platform)
    expect(JSON.parse(buildMetadata({ platform: 'beos', tags: { a: 1 } }) as string).platform).toBeUndefined()
  })

  test('the new-project form offers every native platform', () => {
    const form = readFileSync(resolve(root, 'resources/views/projects/new.stx'), 'utf8')
    for (const platform of NATIVE_PLATFORMS)
      expect(form).toContain(`<option value="${platform}">`)
  })
})

describe('desktop native crashes', () => {
  // The same Swift fixture the iOS tests use: a Mach-O symbol map does not
  // care which Apple platform the binary was built for.
  const [map] = parseSymbolsOutput(readFileSync(resolve(root, 'tests/fixtures/apple-symbols.txt'), 'utf8'))

  test('a macOS crash symbolicates through the Apple resolver and groups on its frames', () => {
    const exception = parseNativeException({
      mechanism: 'signal',
      handled: false,
      signal: 'SIGTRAP',
      frames: [
        { image: 'Fettler', image_uuid: map.uuid, image_offset: 0xAC0, in_app: true },
        { image: 'AppKit', image_offset: 0x4410, symbol: '-[NSApplication run]', in_app: false },
      ],
    })!
    const { frames, symbolicated } = symbolicateAppleFrames(exception.frames, (_uuid, offset) => lookupSymbol(map, offset))
    expect(symbolicated).toBe(1)
    const resolved = { ...exception, frames }
    expect(renderNativeStack('macos', 'SIGTRAP', 'Fatal error', resolved).split('\n')).toEqual([
      'SIGTRAP: Fatal error',
      '    at Player.start(_:) (t.swift:4)',
      '    at -[NSApplication run] (AppKit + 0x4410)',
    ])
    expect(nativeCulprit('macos', resolved)).toBe('Player.start(_:) (t.swift:4)')
    expect(nativeFingerprintParts('macos', 'SIGTRAP', resolved)).toEqual(['native', 'macos', 'SIGTRAP', 'Player.start(_:)'])
  })

  test('the same crash on two desktop platforms is two issues', () => {
    const exception = parseNativeException({ frames: [{ image: 'fettler', function: 'agent::spawn', in_app: true }] })!
    const linux = fingerprintFromParts(nativeFingerprintParts('linux', 'SIGSEGV', exception)!)
    const windows = fingerprintFromParts(nativeFingerprintParts('windows', 'SIGSEGV', exception)!)
    expect(linux).not.toBe(windows)
  })

  test('Windows and Linux frames are kept as the app resolved them, without a lookup', async () => {
    for (const platform of ['windows', 'linux'] as const) {
      const exception = parseNativeException({
        mechanism: 'seh',
        handled: false,
        code: 'EXCEPTION_ACCESS_VIOLATION',
        frames: [
          { image: 'fettler.exe', image_offset: 0x1A2B, function: 'agent::spawn', file: 'src/agent.rs', line: 88, in_app: true },
          { image: 'KERNEL32.DLL', image_offset: 0x17034, symbol: 'BaseThreadInitThunk', in_app: false },
        ],
      })!
      // No project, no database: this path must not need either.
      const result = await symbolicate('proj_none', platform, '1.0.0+41', exception, { type: 'EXCEPTION_ACCESS_VIOLATION', message: 'at 0x10' })
      expect(result.exception).toEqual(exception)
      expect(result.missing).toEqual([])
      expect(renderNativeStack(platform, 'EXCEPTION_ACCESS_VIOLATION', 'at 0x10', result.exception).split('\n')).toEqual([
        'EXCEPTION_ACCESS_VIOLATION: at 0x10',
        '    at agent::spawn (src/agent.rs:88)',
        '    at BaseThreadInitThunk (KERNEL32.DLL + 0x17034)',
      ])
    }
  })
})

describe('desktop sessions in the crash-free rate', () => {
  const now = new Date('2026-11-11T12:00:00.000Z')

  test('a desktop launch is accepted as a session with its platform', () => {
    const sessions = parseSessions({
      platform: 'macos',
      release: '1.0.0+41',
      sessions: [
        { id: 'mac-session-0001', status: 'ok' },
        { id: 'win-session-0001', platform: 'windows', status: 'crashed' },
        { id: 'lin-session-0001', platform: 'linux' },
      ],
    }, now)
    expect(sessions.map(s => [s.platform, s.status, s.release])).toEqual([
      ['macos', 'ok', '1.0.0+41'],
      ['windows', 'crashed', '1.0.0+41'],
      ['linux', 'ok', '1.0.0+41'],
    ])
  })

  test('a desktop crash ends its session as crashed', () => {
    for (const platform of DESKTOP_PLATFORMS) {
      const body = { platform, level: 'fatal', release: '1.0.0+41', session: { id: 'desk-session-0001', startedAt: '2026-11-11T11:00:00.000Z' }, user: { id: 'usr_42' } }
      expect(sessionFromEvent(body, isNativePlatform(body.platform) ? body.platform : null, null, now.toISOString())).toEqual({
        id: 'desk-session-0001',
        release: '1.0.0+41',
        environment: 'production',
        platform,
        status: 'crashed',
        errors: 1,
        startedAt: '2026-11-11T11:00:00.000Z',
        userId: 'usr_42',
      })
    }
  })

  test('an unhandled native exception is a crash; a handled one is not', () => {
    const body = { platform: 'linux', release: '1.0.0+41', session: { id: 'desk-session-0002' } }
    expect(sessionFromEvent(body, 'linux', { handled: false }, now.toISOString())?.status).toBe('crashed')
    expect(sessionFromEvent(body, 'linux', { handled: true }, now.toISOString())?.status).toBe('errored')
  })

  test('a webview or agent JavaScript error marks the session errored, which stays crash-free', () => {
    const body = { platform: 'windows', level: 'error', stack: 'TypeError: x\n    at a (app.js:1:2)', session: { id: 'desk-session-0003' } }
    const update = sessionFromEvent(body, 'windows', null, now.toISOString())
    expect(update?.status).toBe('errored')
    expect(update?.startedAt).toBe(now.toISOString())
  })

  test('a browser event never reaches the session table, and neither does an event without a session', () => {
    const browser = { platform: 'javascript', level: 'fatal', session: { id: 'tab-session-0001' } }
    expect(sessionFromEvent(browser, isNativePlatform(browser.platform) ? browser.platform : null, null, now.toISOString())).toBeNull()
    expect(sessionFromEvent({ platform: 'macos', level: 'fatal' }, 'macos', null, now.toISOString())).toBeNull()
  })

  test('desktop and mobile sessions of one release divide into one rate', () => {
    // A release's sessions as the table would hold them after every update:
    // launches from five platforms, then the events that ended some of them.
    const table = new Map<string, { platform: string | null, status: SessionStatus }>()
    const apply = (id: string, platform: string | null, status: SessionStatus) => {
      const current = table.get(id)
      table.set(id, { platform: current?.platform ?? platform, status: current ? escalate(current.status, status) : status })
    }
    const launches = parseSessions({
      release: '1.0.0+41',
      sessions: [
        ...Array.from({ length: 4 }, (_, i) => ({ id: `ios-session-000${i}`, platform: 'ios' })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: `mac-session-000${i}`, platform: 'macos' })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: `win-session-000${i}`, platform: 'windows' })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: `lin-session-000${i}`, platform: 'linux' })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: `and-session-000${i}`, platform: 'android' })),
      ],
    }, now)
    expect(launches).toHaveLength(20)
    for (const s of launches)
      apply(s.id, s.platform, s.status)

    const events = [
      { platform: 'macos', level: 'fatal', session: { id: 'mac-session-0000' } },
      { platform: 'windows', level: 'fatal', session: { id: 'win-session-0001' } },
      { platform: 'linux', level: 'error', session: { id: 'lin-session-0002' } },
      { platform: 'ios', level: 'fatal', session: { id: 'ios-session-0003' } },
    ]
    for (const body of events) {
      const update = sessionFromEvent(body, isNativePlatform(body.platform) ? body.platform : null, null, now.toISOString())!
      apply(update.id, update.platform, update.status)
    }
    // A late "ok" replayed from an offline queue cannot un-crash a session.
    apply('mac-session-0000', 'macos', 'ok')

    const rows = [...table.values()]
    const crashed = rows.filter(r => r.status === 'crashed')
    expect(crashed.map(r => r.platform).sort()).toEqual(['ios', 'macos', 'windows'])
    // 20 sessions, 3 crashed, 2 of them on desktop: 85%. Counting mobile
    // alone would have read 1 crash in 8 sessions, 87.5%.
    expect(crashFreeRate(rows.length, crashed.length)).toBe(85)
    expect(withCrashFree([{ release: '1.0.0+41', sessions: rows.length, crashed: crashed.length, abnormal: 0, errored: 1, users: 0, first_seen: null, last_seen: null }])[0].crashFreeSessions).toBe(85)
  })

  test('the release queries count every platform: neither filters on one', () => {
    for (const file of ['routes/native.ts', 'resources/views/dashboard.stx']) {
      const source = readFileSync(resolve(root, file), 'utf8')
      const query = source.slice(source.indexOf('FROM app_sessions') - 600, source.indexOf('FROM app_sessions') + 300)
      expect(query).toContain(`status = 'crashed'`)
      expect(query).not.toMatch(/platform\s*(?:=|IN)/i)
    }
  })
})
