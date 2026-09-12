import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildMetadata, clip, col255, MAX_BREADCRUMBS, MAX_MESSAGE } from '../../app/Errors/payload'
import { isIssueStatus, snoozedUntil, statusAfterOccurrence } from '../../app/Errors/triage'

describe('captured event payloads', () => {
  test('persist release and session context together', () => {
    const metadata = JSON.parse(buildMetadata({
      release: '2026.09.12',
      session: { id: 'session-42', status: 'crashed' },
      sdk: { name: '@bughq/browser', version: '1.2.3' },
      timestamp: '2026-09-12T12:00:00.000Z',
    })!)

    expect(col255('2026.09.12')).toBe('2026.09.12')
    expect(metadata.session).toEqual({ id: 'session-42', status: 'crashed' })
    expect(metadata.sdk.version).toBe('1.2.3')
    expect(metadata.client_timestamp).toBe('2026-09-12T12:00:00.000Z')
  })

  test('keeps only the newest breadcrumbs and caps stored values', () => {
    const breadcrumbs = Array.from({ length: MAX_BREADCRUMBS + 5 }, (_, index) => ({ index }))
    const metadata = JSON.parse(buildMetadata({ breadcrumbs })!)

    expect(metadata.breadcrumbs).toHaveLength(MAX_BREADCRUMBS)
    expect(metadata.breadcrumbs[0].index).toBe(5)
    expect(clip('x'.repeat(MAX_MESSAGE + 1), MAX_MESSAGE).endsWith('…[truncated]')).toBe(true)
    expect(col255('x'.repeat(300))).toHaveLength(255)
  })

  test('drops oversized free-form metadata but keeps diagnostic identity', () => {
    const metadata = JSON.parse(buildMetadata({
      extra: { value: 'x'.repeat(100_000) },
      session: { id: 'session-42' },
      sdk: { name: '@bughq/browser' },
    })!)

    expect(metadata.extra).toBeUndefined()
    expect(metadata.session.id).toBe('session-42')
    expect(metadata.sdk.name).toBe('@bughq/browser')
    expect(metadata._truncated).toBe('oversized metadata dropped')
  })
})

describe('issue triage lifecycle', () => {
  test('accepts only dashboard-visible statuses', () => {
    expect(isIssueStatus('unresolved')).toBe(true)
    expect(isIssueStatus('resolved')).toBe(true)
    expect(isIssueStatus('ignored')).toBe(true)
    expect(isIssueStatus('snoozed')).toBe(false)
  })

  test('a resolved regression reopens while an ignored repeat stays ignored', () => {
    expect(statusAfterOccurrence('resolved')).toBe('unresolved')
    expect(statusAfterOccurrence('ignored')).toBe('ignored')
    expect(statusAfterOccurrence('unresolved')).toBe('unresolved')
    expect(statusAfterOccurrence(null)).toBe('unresolved')
  })

  test('snooze presets are server-owned and deterministic', () => {
    const now = Date.parse('2026-09-12T00:00:00.000Z')
    expect(snoozedUntil('1h', now)).toBe('2026-09-12T01:00:00.000Z')
    expect(snoozedUntil('1w', now)).toBe('2026-09-19T00:00:00.000Z')
    expect(snoozedUntil('forever', now)).toBeNull()
  })

  test('the database upsert mirrors the pure lifecycle rule', () => {
    const route = readFileSync(resolve(import.meta.dir, '../../routes/errors.ts'), 'utf8')
    expect(route).toContain("WHEN issues.status = 'resolved' THEN 'unresolved'")
    expect(route).toContain('ELSE issues.status')
    expect(route).toContain('ON CONFLICT (project_id, fingerprint) DO UPDATE')
  })
})
