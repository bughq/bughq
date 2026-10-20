import { describe, expect, test } from 'bun:test'
import { authorizeRead, LAST_USED_RESOLUTION_MS, looksLikeReadKey, newReadKey, sameKey, shouldRecordUse } from '../../app/Support/read-key'

const KEY = newReadKey()
const project = { id: 'demo', read_key: KEY, is_active: true }

describe('newReadKey', () => {
  test('is prefixed and carries 256 bits of hex', () => {
    expect(KEY.startsWith('bughq_read_')).toBe(true)
    expect(KEY.slice('bughq_read_'.length)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newReadKey()))
    expect(keys.size).toBe(200)
  })
})

describe('looksLikeReadKey', () => {
  test('accepts a key it minted', () => {
    expect(looksLikeReadKey(KEY)).toBe(true)
  })

  test('rejects anything else a bearer header might carry', () => {
    // The prefix is what keeps a read key out of Auth.getUserFromToken, so a
    // user's token and an ingest key must never pass for one.
    for (const value of [
      '',
      null,
      undefined,
      'bughq_up_5f3a19b7c4d2e8091ab12cd34ef56ab7',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      `${'bughq_read_'}${'z'.repeat(64)}`,
      `${'bughq_read_'}${'a'.repeat(63)}`,
      `${'bughq_read_'}${'a'.repeat(65)}`,
      KEY.toUpperCase(),
    ])
      expect(looksLikeReadKey(value)).toBe(false)
  })
})

describe('sameKey', () => {
  test('matches an identical key and nothing else', () => {
    expect(sameKey(KEY, KEY)).toBe(true)
    expect(sameKey(KEY, newReadKey())).toBe(false)
  })

  test('is false on a shared prefix, not just a differing first byte', () => {
    const other = `${KEY.slice(0, -1)}${KEY.endsWith('a') ? 'b' : 'a'}`
    expect(sameKey(other, KEY)).toBe(false)
  })

  test('does not throw on a length mismatch', () => {
    expect(sameKey('short', KEY)).toBe(false)
    expect(sameKey(KEY, 'short')).toBe(false)
  })
})

describe('authorizeRead', () => {
  test('allows the project its own key', () => {
    expect(authorizeRead(project, KEY)).toEqual({ ok: true })
  })

  test('refuses an unknown project with 404', () => {
    expect(authorizeRead(null, KEY)).toEqual({ ok: false, status: 404, error: 'unknown project' })
    expect(authorizeRead(undefined, KEY)).toEqual({ ok: false, status: 404, error: 'unknown project' })
  })

  test('refuses an inactive project with 403, however is_active is stored', () => {
    // sqlite hands booleans back as 0/1.
    expect(authorizeRead({ ...project, is_active: false }, KEY).ok).toBe(false)
    expect(authorizeRead({ ...project, is_active: 0 }, KEY)).toEqual({ ok: false, status: 403, error: 'project inactive' })
  })

  test('refuses a project with no key issued, whatever is presented', () => {
    // Guards `null === null`: no key configured must never authorise, not even
    // against a caller presenting nothing.
    for (const presented of [KEY, null, undefined, ''])
      expect(authorizeRead({ ...project, read_key: null }, presented).ok).toBe(false)
    expect(authorizeRead({ ...project, read_key: null }, KEY).status).toBe(403)
  })

  test('refuses another project\'s key with 401', () => {
    expect(authorizeRead(project, newReadKey())).toEqual({ ok: false, status: 401, error: 'invalid read key' })
  })

  test('refuses an upload token, which is not a session and not a read key', () => {
    expect(authorizeRead({ ...project, read_key: KEY }, 'bughq_up_5f3a19b7c4d2e8091ab12cd34ef56ab7').ok).toBe(false)
  })

  test('refuses a stored value that is not a well-formed key', () => {
    // A column hand-edited to something short must not become a weak key.
    expect(authorizeRead({ ...project, read_key: 'x' }, 'x').ok).toBe(false)
  })
})

describe('shouldRecordUse', () => {
  const now = new Date('2026-10-19T12:00:00.000Z')

  test('records the first use', () => {
    expect(shouldRecordUse(null, now)).toBe(true)
    expect(shouldRecordUse(undefined, now)).toBe(true)
  })

  test('records again once the resolution has passed, and not before', () => {
    const justBefore = new Date(now.getTime() - LAST_USED_RESOLUTION_MS + 1).toISOString()
    const atResolution = new Date(now.getTime() - LAST_USED_RESOLUTION_MS).toISOString()
    expect(shouldRecordUse(justBefore, now)).toBe(false)
    expect(shouldRecordUse(atResolution, now)).toBe(true)
  })

  test('records when the stored stamp cannot be read', () => {
    // Better an extra write than a key that never looks used.
    expect(shouldRecordUse('not a date', now)).toBe(true)
  })

  test('accepts a Date as well as a string', () => {
    expect(shouldRecordUse(new Date(now.getTime() - 1000), now)).toBe(false)
  })
})
