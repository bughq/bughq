import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { looksLikeReadKey, newReadKey } from '../../app/Support/read-key'
import { authorizeTriage, bulkIssueIds, looksLikeProjectKey, looksLikeTriageKey, MAX_BULK_TRIAGE, newTriageKey } from '../../app/Support/triage-key'

const KEY = newTriageKey()
const project = { id: 'demo', triage_key: KEY, is_active: true }
const read = (path: string): string => readFileSync(join(import.meta.dir, '../..', path), 'utf8')

describe('newTriageKey', () => {
  test('is prefixed and carries 256 bits of hex', () => {
    expect(KEY.startsWith('bughq_triage_')).toBe(true)
    expect(KEY.slice('bughq_triage_'.length)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newTriageKey()))
    expect(keys.size).toBe(200)
  })
})

describe('looksLikeTriageKey', () => {
  test('accepts a key it minted', () => {
    expect(looksLikeTriageKey(KEY)).toBe(true)
  })

  test('rejects every other credential a bearer header might carry', () => {
    for (const value of [
      '',
      null,
      undefined,
      newReadKey(),
      'bughq_up_5f3a19b7c4d2e8091ab12cd34ef56ab7',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      `${'bughq_triage_'}${'z'.repeat(64)}`,
      `${'bughq_triage_'}${'a'.repeat(63)}`,
      KEY.toUpperCase(),
    ])
      expect(looksLikeTriageKey(value)).toBe(false)
  })

  test('a read key and a triage key never pass for each other', () => {
    // The whole point of two keys: reading does not come with closing issues,
    // and closing issues does not come with reading.
    expect(looksLikeReadKey(KEY)).toBe(false)
    expect(looksLikeTriageKey(newReadKey())).toBe(false)
  })

  test('both are project keys, so neither is tried as a session', () => {
    expect(looksLikeProjectKey(KEY)).toBe(true)
    expect(looksLikeProjectKey(newReadKey())).toBe(true)
    expect(looksLikeProjectKey('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig')).toBe(false)
  })
})

describe('authorizeTriage', () => {
  test('allows the project its own key', () => {
    expect(authorizeTriage(project, KEY)).toEqual({ ok: true })
  })

  test('an unknown project is a 404', () => {
    expect(authorizeTriage(null, KEY)).toEqual({ ok: false, status: 404, error: 'unknown project' })
  })

  test('an archived project refuses its own key', () => {
    expect(authorizeTriage({ ...project, is_active: false }, KEY)).toMatchObject({ ok: false, status: 403 })
    expect(authorizeTriage({ ...project, is_active: 0 }, KEY)).toMatchObject({ ok: false, status: 403 })
  })

  test('a project with no key issued refuses every key, an empty one included', () => {
    for (const presented of [KEY, '', null, undefined])
      expect(authorizeTriage({ id: 'demo', triage_key: null, is_active: true }, presented)).toMatchObject({ ok: false, status: 403 })
  })

  test('another project\'s key, a read key and a malformed key are all refused', () => {
    for (const presented of [newTriageKey(), newReadKey(), 'nope', '', null])
      expect(authorizeTriage(project, presented)).toEqual({ ok: false, status: 401, error: 'invalid triage key' })
  })
})

describe('bulkIssueIds', () => {
  test('keeps the ids in order and drops repeats', () => {
    expect(bulkIssueIds(['b', 'a', 'b'])).toEqual(['b', 'a'])
  })

  test('refuses anything that is not a list of ids within the limit', () => {
    const tooMany = Array.from({ length: MAX_BULK_TRIAGE + 1 }, (_, index) => `id${index}`)
    for (const value of [undefined, null, 'abc', {}, [], [1], ['ok', null], ['has space'], ['a\'; DROP TABLE issues; --'], tooMany])
      expect(bulkIssueIds(value)).toBeNull()
  })

  test('accepts exactly the limit', () => {
    const atLimit = Array.from({ length: MAX_BULK_TRIAGE }, (_, index) => `id${index}`)
    expect(bulkIssueIds(atLimit)).toHaveLength(MAX_BULK_TRIAGE)
  })
})

describe('the triage routes', () => {
  const errors = read('routes/errors.ts')
  const access = read('app/Support/access.ts')

  test('authorise before they validate or write', () => {
    const body = errors.slice(errors.indexOf('async function changeIssueStatuses'))
    expect(body.indexOf('projectTriageAccess(request, projectId)')).toBeGreaterThan(-1)
    expect(body.indexOf('projectTriageAccess(request, projectId)')).toBeLessThan(body.indexOf('UPDATE issues SET status'))
  })

  test('scope the write to the project in the path, so a key cannot reach another project\'s issue', () => {
    const body = errors.slice(errors.indexOf('async function changeIssueStatuses'))
    expect(body).toContain('WHERE project_id = $2 AND id IN (')
  })

  test('a read key is refused rather than treated as a session or a triage key', () => {
    const triage = access.slice(access.indexOf('export async function projectTriageAccess'))
    expect(triage.indexOf('if (!looksLikeTriageKey(presented))')).toBeLessThan(triage.indexOf('currentUser(request)'))
  })

  test('the read endpoints do not accept a triage key', () => {
    const readAccess = access.slice(access.indexOf('export async function projectReadAccess'), access.indexOf('export type ProjectTriageAccess'))
    expect(readAccess).not.toContain('triage')
  })

  test('the key is issued and revoked by the owner only', () => {
    const projects = read('routes/projects.ts')
    for (const verb of ['route.post(\'/api/projects/{projectId}/triage-key\'', 'route.delete(\'/api/projects/{projectId}/triage-key\'']) {
      const handler = projects.slice(projects.indexOf(verb))
      expect(handler.indexOf('ownsProject(user, projectId)')).toBeLessThan(handler.indexOf('UPDATE projects SET triage_key'))
    }
  })
})
