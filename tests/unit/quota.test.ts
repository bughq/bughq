import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCounter, createMemoryCounterStore, droppedMeter, parseUsageHeader, USAGE_HEADER } from '@stacksjs/hq/meter'
import { admitError } from '../../app/Billing/meter'
import { ERRORS_METER, errorsPerMonth, formatAllowance, FREE_ERRORS_PER_MONTH } from '../../app/Billing/plans'

const UPGRADE = 'https://bughq.test/pricing'
const OWNER = 7

function meter() {
  const store = createMemoryCounterStore()
  // No timer: the test flushes when it wants the durable total.
  const counter = createCounter({ store, flushMs: 0, now: () => new Date('2026-03-10T12:00:00.000Z') })
  const send = (pro = false, owner: number | null = OWNER) => admitError(counter, owner, pro, UPGRADE)
  const sendMany = (n: number, pro = false) => Array.from({ length: n }, () => send(pro))
  return { store, counter, send, sendMany }
}

describe('the free allowance', () => {
  test('is 500 errors a month, and unlimited on Pro', () => {
    expect(FREE_ERRORS_PER_MONTH).toBe(500)
    expect(errorsPerMonth(false)).toBe(500)
    expect(errorsPerMonth(true)).toBeNull()
  })

  test('the pricing page prints the limits file instead of restating it', () => {
    const page = readFileSync(resolve(import.meta.dir, '../../resources/views/pricing.stx'), 'utf8')
    expect(page).toContain('~/app/Billing/plans')
    expect(page).toContain('{{ freeErrors }} errors a month')
    // No allowance typed into the markup, in any spelling.
    expect(page).not.toMatch(/\b(?:5k|5,000|500)\s+errors/i)
    expect(formatAllowance(FREE_ERRORS_PER_MONTH)).toBe('500')
    expect(formatAllowance(5000)).toBe('5,000')
  })
})

describe('ingest metering on Free', () => {
  test('under the limit every error is kept and the header reports the count', () => {
    const { send, sendMany } = meter()
    const first = send()
    expect(first.accept).toBe(true)
    expect(parseUsageHeader(first.headers[USAGE_HEADER])).toEqual({ meter: ERRORS_METER, used: 1, limit: 500, state: 'ok', upgradeUrl: UPGRADE })

    const rest = sendMany(398)
    expect(rest.every(decision => decision.accept)).toBe(true)
    expect(rest.at(-1)!.admission.state).toBe('ok')
  })

  test('warns from 80% of the allowance, still keeping everything', () => {
    const { send, sendMany } = meter()
    sendMany(399)
    const at400 = send()
    expect(at400.accept).toBe(true)
    expect(parseUsageHeader(at400.headers[USAGE_HEADER])).toMatchObject({ used: 400, limit: 500, state: 'warn' })
  })

  test('from 100% to 120% every error is still kept, reported as over', () => {
    const { send, sendMany } = meter()
    sendMany(499)
    const band = sendMany(101) // the 500th through the 600th
    expect(band.every(decision => decision.accept)).toBe(true)
    expect(band.every(decision => decision.admission.state === 'over')).toBe(true)
    expect(parseUsageHeader(band[0]!.headers[USAGE_HEADER])).toMatchObject({ used: 500, limit: 500, state: 'over' })
    expect(parseUsageHeader(band.at(-1)!.headers[USAGE_HEADER])).toMatchObject({ used: 600, limit: 500, state: 'over' })
    // The 601st is the first one past the grace.
    expect(send().accept).toBe(false)
  })

  test('past 120% one error in ten is kept, and the answer still carries the header', async () => {
    const { send, sendMany, counter, store } = meter()
    sendMany(600)
    const past = sendMany(100)
    expect(past.filter(decision => decision.accept)).toHaveLength(10)
    expect(past.every(decision => decision.admission.state === 'sampled')).toBe(true)
    // Exactly every tenth, not ten at random: 610, 620, ...
    expect(past.map((decision, index) => decision.accept ? index + 1 : 0).filter(Boolean)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])

    // `used` is what was stored, not what was received.
    const dropped = send()
    expect(dropped.accept).toBe(false)
    expect(parseUsageHeader(dropped.headers[USAGE_HEADER])).toEqual({ meter: ERRORS_METER, used: 610, limit: 500, state: 'sampled', upgradeUrl: UPGRADE })

    await counter.flush()
    const totals = Object.fromEntries(store.totals().map(row => [row.meter, row.delta]))
    expect(totals[ERRORS_METER]).toBe(610)
    expect(totals[droppedMeter(ERRORS_METER)]).toBe(91)
    expect(store.totals().every(row => row.owner === String(OWNER) && row.period === '2026-03')).toBe(true)
  })

  test('one account going over does not touch another', () => {
    const { counter, sendMany } = meter()
    sendMany(700)
    const other = admitError(counter, 8, false, UPGRADE)
    expect(other.accept).toBe(true)
    expect(other.admission.used).toBe(1)
  })
})

describe('ingest metering for accounts that are not limited', () => {
  test('a Pro account is counted and never sampled', () => {
    const { sendMany } = meter()
    const all = sendMany(2000, true)
    expect(all.every(decision => decision.accept)).toBe(true)
    expect(parseUsageHeader(all.at(-1)!.headers[USAGE_HEADER])).toEqual({ meter: ERRORS_METER, used: 2000, limit: null, state: 'ok', upgradeUrl: UPGRADE })
  })

  test('an account that upgrades mid-month stops being sampled at once', () => {
    const { send, sendMany } = meter()
    sendMany(650)
    expect(sendMany(9).some(decision => decision.accept)).toBe(false)
    const afterUpgrade = sendMany(50, true)
    expect(afterUpgrade.every(decision => decision.accept)).toBe(true)
    expect(send(true).admission.limit).toBeNull()
  })

  test('a project with no owner is not metered and never dropped', async () => {
    const { send, counter, store } = meter()
    const decisions = Array.from({ length: 1000 }, () => send(false, null))
    expect(decisions.every(decision => decision.accept)).toBe(true)
    expect(parseUsageHeader(decisions.at(-1)!.headers[USAGE_HEADER])).toMatchObject({ limit: null, state: 'ok' })
    await counter.flush()
    expect(store.totals()).toEqual([])
  })
})

describe('the ingest route', () => {
  const source = readFileSync(resolve(import.meta.dir, '../../routes/errors.ts'), 'utf8')

  test('answers 2xx for an event it does not keep', () => {
    // The whole point of soft enforcement: a non-2xx would be retried.
    expect(source).toMatch(/if \(!quota\.accept\)\s+return json\(\{ ok: true, sampled: true \}, 200, quota\.headers\)/)
    expect(source).not.toMatch(/quota[^\n]*\b(?:402|403|429)\b/)
  })

  test('sends X-HQ-Usage on a stored event and lets a browser SDK read it', () => {
    expect(source).toContain('return json({ ok: true, issue: issueId }, 201, quota.headers)')
    expect(source).toContain('\'Access-Control-Expose-Headers\': USAGE_HEADER')
  })

  test('decides before anything is written', () => {
    expect(source.indexOf('admitError(')).toBeGreaterThan(0)
    expect(source.indexOf('admitError(')).toBeLessThan(source.indexOf('INSERT INTO issues'))
  })
})
