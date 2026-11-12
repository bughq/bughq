import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCounter, createMemoryCounterStore, droppedMeter, parseUsageHeader, sqlCounterStore, USAGE_HEADER } from '@stacksjs/hq/meter'
import { admitError } from '../../app/Billing/admission'
import { ERRORS_METER, errorsLimitFor, FREE_ERRORS_PER_MONTH, FREE_PROJECTS, freeErrorsLabel, freeOverageLabel } from '../../app/Billing/limits'
import { hqDatabase, migrate, sqliteClient } from '../support/sqlite-hq'

const root = resolve(import.meta.dir, '../..')
const UPGRADE = 'https://bughq.test/pricing'

function harness(plan: 'free' | 'pro' = 'free') {
  const store = createMemoryCounterStore()
  const counter = createCounter({ store, flushMs: 0 })
  const deps = { counter, isPro: async () => plan === 'pro', upgradeUrl: () => UPGRADE }
  /** Send `count` events for one owner; answer how many were kept and the last header. */
  async function send(count: number, owner: number | null = 1) {
    let kept = 0
    let last = await admitError(owner, deps)
    kept += last.accept ? 1 : 0
    for (let i = 1; i < count; i++) {
      last = await admitError(owner, deps)
      kept += last.accept ? 1 : 0
    }
    return { kept, last, header: parseUsageHeader(last.headers[USAGE_HEADER]) }
  }
  return { store, counter, send }
}

describe('the limits file', () => {
  test('Free is 500 errors a month', () => {
    expect(FREE_ERRORS_PER_MONTH).toBe(500)
    expect(errorsLimitFor('free')).toBe(500)
  })

  test('a paid plan is unlimited', () => {
    expect(errorsLimitFor('pro')).toBeNull()
  })

  test('the copy is built from the numbers, so it cannot disagree with them', () => {
    expect(freeErrorsLabel()).toBe('500 errors a month')
    expect(freeOverageLabel()).toContain('up to 600 that month')
    expect(freeOverageLabel()).toContain('one in 10')
  })

  test('no user-visible line carries an em-dash or a separator en-dash', () => {
    expect(`${freeErrorsLabel()} ${freeOverageLabel()}`).not.toMatch(/[–—]/)
  })

  test('the pricing page renders the allowance from the limits file, not a literal', () => {
    const page = readFileSync(resolve(root, 'resources/views/pricing.stx'), 'utf8')
    expect(page).toContain(`import('~/app/Billing/limits')`)
    expect(page).toContain('{{ freeErrors }}')
    expect(page).toContain('{{ freeOverage }}')
    expect(page).toContain('{{ freeProjects }}')
    expect(page).not.toMatch(/\b5k errors\b/)
    expect(page).not.toMatch(/\d[\d,]*\s+errors a month/)
    expect(FREE_PROJECTS).toBeGreaterThan(0)
  })
})

describe('ingest admission on Free', () => {
  test('under the limit every event is kept', async () => {
    const { send } = harness()
    const { kept, header } = await send(399)
    expect(kept).toBe(399)
    expect(header).toEqual({ meter: 'errors', used: 399, limit: 500, state: 'ok', upgradeUrl: UPGRADE })
  })

  test('the header warns from 80% of the allowance', async () => {
    const { send } = harness()
    expect((await send(400)).header?.state).toBe('warn')
    expect((await send(99)).header).toMatchObject({ used: 499, state: 'warn' })
  })

  test('from 100% to 120% every event is still kept, and the header says over', async () => {
    const { send } = harness()
    await send(499)
    const atLimit = await send(1)
    expect(atLimit.kept).toBe(1)
    expect(atLimit.header).toMatchObject({ used: 500, limit: 500, state: 'over' })

    const band = await send(100)
    expect(band.kept).toBe(100)
    expect(band.header).toMatchObject({ used: 600, limit: 500, state: 'over' })
  })

  test('past 120% one event in ten is kept', async () => {
    const { send, counter } = harness()
    await send(600)
    const first = await send(9)
    expect(first.kept).toBe(0)
    expect(first.header).toMatchObject({ used: 600, state: 'sampled' })

    const tenth = await send(1)
    expect(tenth.kept).toBe(1)
    expect(tenth.header).toMatchObject({ used: 601, state: 'sampled' })

    const next = await send(990)
    expect(next.kept).toBe(99)
    // 1,600 received: 700 stored, 900 sampled out and counted apart.
    expect(counter.usageOf(1, ERRORS_METER)).toBe(700)
    expect(counter.usageOf(1, droppedMeter(ERRORS_METER))).toBe(900)
  })

  test('a sampled-out event still carries the usage header', async () => {
    const { send } = harness()
    await send(600)
    const { last, header } = await send(1)
    expect(last.accept).toBe(false)
    expect(header).toEqual({ meter: 'errors', used: 600, limit: 500, state: 'sampled', upgradeUrl: UPGRADE })
  })

  test('the allowance is per account: one owner going over does not touch another', async () => {
    const { send } = harness()
    await send(700, 1)
    const other = await send(1, 2)
    expect(other.kept).toBe(1)
    expect(other.header).toMatchObject({ used: 1, state: 'ok' })
  })
})

describe('ingest admission with no limit', () => {
  test('a paid account is counted and never dropped', async () => {
    const { send, counter } = harness('pro')
    const { kept, header } = await send(2000)
    expect(kept).toBe(2000)
    expect(header).toEqual({ meter: 'errors', used: 2000, limit: null, state: 'ok', upgradeUrl: UPGRADE })
    expect(counter.usageOf(1, droppedMeter(ERRORS_METER)) ?? 0).toBe(0)
  })

  test('a project with no owner is not metered and never dropped', async () => {
    const { send, store } = harness()
    const { kept, header } = await send(1000, null)
    expect(kept).toBe(1000)
    expect(header).toMatchObject({ limit: null, state: 'ok' })
    expect(store.totals()).toEqual([])
  })
})

describe('the ingest route', () => {
  const route = readFileSync(resolve(root, 'routes/errors.ts'), 'utf8')

  test('decides before anything is written', () => {
    const decided = route.indexOf('await admitError(')
    expect(decided).toBeGreaterThan(-1)
    expect(decided).toBeLessThan(route.indexOf('INSERT INTO issues'))
    expect(decided).toBeLessThan(route.indexOf(`insertInto('error_events')`))
  })

  test('answers 2xx with the usage header whether the event was kept or sampled out', () => {
    expect(route).toContain('return json({ ok: true, sampled: true }, 202, usage.headers)')
    expect(route).toContain('return json({ ok: true, issue: issueId }, 201, usage.headers)')
  })

  test('never answers a quota with a refusal', () => {
    // The only way out of the route on the admission's say-so is the 202.
    const decision = route.slice(route.indexOf('await admitError('), route.indexOf('const { fingerprintParts: fpOverride }'))
    expect(decision.match(/return json\(/g)).toHaveLength(1)
    expect(decision).toContain('}, 202, usage.headers)')
    expect(route).not.toMatch(/, 402\b|payment required/i)
  })

  test('lets a browser SDK read the header across origins', () => {
    expect(route).toContain(`'Access-Control-Expose-Headers': 'X-HQ-Usage'`)
  })
})

describe('the usage counter table', () => {
  test('the migration creates what the counter store writes to, and totals add up across flushes', async () => {
    const db = hqDatabase()
    migrate(db)
    const store = sqlCounterStore(sqliteClient(db), { dialect: 'postgres', table: 'hq_usage_counters' })
    const counter = createCounter({ store, flushMs: 0, now: () => new Date('2026-11-12T00:00:00.000Z') })

    for (let i = 0; i < 620; i++)
      counter.admit(7, ERRORS_METER, FREE_ERRORS_PER_MONTH)
    await counter.flush()
    counter.admit(7, ERRORS_METER, FREE_ERRORS_PER_MONTH)
    await counter.flush()

    const stored = db.query('SELECT meter, period, used FROM hq_usage_counters WHERE owner = ? ORDER BY meter').all('7')
    expect(stored).toEqual([
      { meter: 'errors', period: '2026-11', used: 602 },
      { meter: 'errors.dropped', period: '2026-11', used: 19 },
    ])
    expect(await counter.read(7, ERRORS_METER)).toBe(602)
  })

  test('the migration carries the counts already taken across, once', () => {
    const db = hqDatabase()
    db.exec(`
      INSERT INTO usage_counters (owner_id, period, accepted, rejected) VALUES (1, '2026-10', 4200, 0);
      INSERT INTO usage_counters (owner_id, period, accepted, rejected) VALUES (1, '2026-11', 380, 0);
      INSERT INTO usage_counters (owner_id, period, accepted, rejected) VALUES (2, '2026-11', 0, 12);
    `)
    migrate(db)
    migrate(db) // applying it twice must not double anything
    const rows = db.query('SELECT owner, meter, period, used FROM hq_usage_counters ORDER BY owner, period, meter').all()
    expect(rows).toEqual([
      { owner: '1', meter: 'errors', period: '2026-10', used: 4200 },
      { owner: '1', meter: 'errors', period: '2026-11', used: 380 },
      { owner: '2', meter: 'errors.dropped', period: '2026-11', used: 12 },
    ])
    // The old table is the record of past months; it is left alone.
    expect(db.query('SELECT COUNT(*) AS n FROM usage_counters').get()).toEqual({ n: 3 })
  })
})
