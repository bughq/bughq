import { describe, expect, test } from 'bun:test'
import {
  categorize,
  culprit,
  fingerprint,
  issueTitle,
  normalizeMessage,
  randomId,
  topFrame,
} from '../../app/Errors/fingerprint'

const STACK = `TypeError: Cannot read properties of undefined (reading 'name')
    at renderUser (app/components/User.tsx:42:18)
    at App (app/App.tsx:11:3)`

describe('normalizeMessage', () => {
  test('strips volatile numbers, uuids, hex, and quoted literals', () => {
    expect(normalizeMessage('user 12345 not found')).toBe('user N not found')
    expect(normalizeMessage('ptr 0xdeadBEEF freed')).toBe('ptr 0xADDR freed')
    expect(normalizeMessage('id 550e8400-e29b-41d4-a716-446655440000 gone'))
      .toBe('id UUID gone')
    expect(normalizeMessage('bad token "abc123"')).toBe('bad token "…"')
  })

  test('is stable across id/number drift (same normalized form)', () => {
    expect(normalizeMessage('order 41 failed')).toBe(normalizeMessage('order 999 failed'))
  })

  test('caps length at 300 chars', () => {
    expect(normalizeMessage('x'.repeat(500)).length).toBe(300)
  })
})

describe('one error across deploys', () => {
  const at = (release: string) => `Error: busy\n    at handle (/var/www/app/releases/${release}/app/Jobs/SyncJob.ts:25:48)`

  test('groups the same frame from two release directories into one issue', () => {
    expect(fingerprint('Error', 'busy', at('2f9ed4289'))).toBe(fingerprint('Error', 'busy', at('4ac2101e3')))
    expect(fingerprint('Error', 'busy', at('20261115T160000'))).toBe(fingerprint('Error', 'busy', at('2f9ed4289')))
  })

  test('still tells two files apart, and leaves a path with no release in it alone', () => {
    expect(fingerprint('Error', 'busy', at('2f9ed4289')))
      .not.toBe(fingerprint('Error', 'busy', at('2f9ed4289').replace('SyncJob', 'OtherJob')))
    expect(fingerprint('Error', 'busy', 'Error: busy\n    at f (app/a.ts:10:5)'))
      .toBe(fingerprint('Error', 'busy', 'Error: busy\n    at f (app/a.ts:88:2)'))
  })
})

describe('topFrame', () => {
  test('picks the first application frame, skipping vendor frames', () => {
    const stack = `Error: boom
    at internalThing (node:internal/process:5:1)
    at libFn (/x/node_modules/pkg/index.js:9:2)
    at handler (app/routes/api.ts:7:11)`
    expect(topFrame(stack)).toContain('app/routes/api.ts')
    expect(topFrame(stack)).not.toContain('node_modules')
  })

  test('drops :line:col so small drift does not change the frame', () => {
    expect(topFrame('E\n    at f (app/a.ts:10:5)'))
      .toBe(topFrame('E\n    at f (app/a.ts:88:2)'))
  })

  test('returns empty string for missing stack', () => {
    expect(topFrame(undefined)).toBe('')
  })
})

describe('fingerprint', () => {
  test('is a stable 32-char hex hash', () => {
    const fp = fingerprint('TypeError', 'boom', STACK)
    expect(fp).toMatch(/^[0-9a-f]{32}$/)
    expect(fp).toBe(fingerprint('TypeError', 'boom', STACK))
  })

  test('groups occurrences that differ only in volatile tokens', () => {
    const a = fingerprint('TypeError', "Cannot read x of user 42", STACK.replace('42:18', '42:19'))
    const b = fingerprint('TypeError', "Cannot read x of user 91", STACK.replace('42:18', '99:1'))
    expect(a).toBe(b)
  })

  test('separates different error types', () => {
    expect(fingerprint('TypeError', 'boom', STACK))
      .not.toBe(fingerprint('RangeError', 'boom', STACK))
  })

  test('separates semantically different messages', () => {
    expect(fingerprint('Error', 'disk full', undefined))
      .not.toBe(fingerprint('Error', 'network down', undefined))
  })

  test('defaults a missing type to Error', () => {
    expect(fingerprint('', 'boom', undefined)).toBe(fingerprint('Error', 'boom', undefined))
  })
})

describe('issueTitle', () => {
  test('formats as "Type: message"', () => {
    expect(issueTitle('TypeError', 'cannot read x')).toBe('TypeError: cannot read x')
  })

  test('uses only the first line and caps message length', () => {
    expect(issueTitle('Error', 'line one\nline two')).toBe('Error: line one')
    expect(issueTitle('Error', 'm'.repeat(300)).length).toBeLessThanOrEqual('Error: '.length + 240)
  })

  test('falls back to the type when message is empty', () => {
    expect(issueTitle('SyntaxError', '')).toBe('SyntaxError')
  })
})

describe('culprit', () => {
  test('extracts the callsite from the top app frame', () => {
    expect(culprit(STACK)).toContain('renderUser')
  })

  test('returns empty string when there is no stack', () => {
    expect(culprit(undefined)).toBe('')
  })
})

describe('categorize', () => {
  test.each([
    ['TypeError', 'x is not a function', 'type'],
    ['ReferenceError', 'y is not defined', 'reference'],
    ['SyntaxError', 'Unexpected token', 'syntax'],
    ['Error', 'Failed to fetch', 'network'],
    ['Error', 'Content Security Policy blocked', 'security'],
    ['RangeError', 'Maximum call stack size exceeded', 'range'],
    ['Error', 'something odd', 'other'],
  ])('%s / "%s" -> %s', (type, message, expected) => {
    expect(categorize(type, message)).toBe(expected)
  })
})

describe('randomId', () => {
  test('is 24 hex chars and unique across calls', () => {
    const a = randomId()
    const b = randomId()
    expect(a).toMatch(/^[0-9a-f]{24}$/)
    expect(a).not.toBe(b)
  })
})
