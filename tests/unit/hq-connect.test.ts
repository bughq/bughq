import type { ConnectGrant, UsageReport } from '@stacksjs/hq/service'
import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCounter, sqlCounterStore } from '@stacksjs/hq/meter'
import { createHqService } from '@stacksjs/hq/service'
import { hqServiceContract } from '@stacksjs/hq/testing'
import { ERRORS_METER, FREE_PROJECTS } from '../../app/Billing/limits'
import { createBughqAdapter, ProjectLimitError } from '../../app/Hq/adapter'
import { looksLikeReadKey } from '../../app/Support/read-key'
import { hqDatabase, migrate, sqliteClient } from '../support/sqlite-hq'

const root = resolve(import.meta.dir, '../..')
const ORIGIN = 'https://bughq.test'

/**
 * The real adapter and the package's real SQL stores, over an in-memory
 * database carrying the committed migrations.
 */
function harness(options: { pro?: number[] } = {}) {
  const db: Database = hqDatabase()
  migrate(db)
  const sql = sqliteClient(db)
  const clock = { at: Date.parse('2026-11-12T09:00:00.000Z') }
  const now = (): Date => new Date(clock.at)
  const counter = createCounter({
    store: sqlCounterStore(sql, { dialect: 'postgres', table: 'hq_usage_counters' }),
    flushMs: 0,
    now,
  })
  const pro = new Set(options.pro ?? [])
  const adapter = createBughqAdapter({
    sql,
    dialect: 'postgres',
    counter,
    isPro: async owner => owner != null && pro.has(Number(owner)),
    appUrl: () => ORIGIN,
  })
  const service = createHqService(adapter, { now, codeTtlMs: 600_000 })

  const request = (path: string, init: { method?: string, body?: unknown, headers?: Record<string, string> } = {}): Request => new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  async function start(app: string): Promise<{ code: string, approveUrl: string }> {
    const response = await service.startConnect(request('/api/cli/connect', { method: 'POST', body: { app } }))
    expect(response.status).toBe(201)
    return await response.json() as { code: string, approveUrl: string }
  }
  async function poll(code: string): Promise<{ status: number, body: Record<string, unknown> }> {
    const response = await service.pollConnect(request(`/api/cli/connect/${code}`), code)
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  async function connect(app: string, userId: number): Promise<ConnectGrant> {
    const { code } = await start(app)
    expect(await service.approveConnect(code, { id: userId })).toMatchObject({ ok: true })
    return (await poll(code)).body as unknown as ConnectGrant
  }
  async function usage(key?: string): Promise<{ status: number, body: unknown }> {
    const response = await service.usage(request('/api/v1/usage', { headers: key ? { Authorization: `Bearer ${key}` } : {} }))
    return { status: response.status, body: await response.json() }
  }
  const projects = (): Record<string, unknown>[] => db.query('SELECT id, name, platform, ingest_key, read_key, owner_id FROM projects ORDER BY created_at, id').all() as Record<string, unknown>[]

  return { db, counter, clock, service, adapter, start, poll, connect, usage, projects }
}

// The suite every HQ service runs against its own adapter.
hqServiceContract('bughq', () => ({ adapter: harness().adapter, user: { id: 1 } }))

describe('connecting an app', () => {
  test('starting answers a code and this service\'s approve page', async () => {
    const { start } = harness()
    const { code, approveUrl } = await start('cursio')
    expect(approveUrl).toBe(`${ORIGIN}/cli/connect?code=${encodeURIComponent(code)}`)
  })

  test('a code is pending, and creates nothing, until someone approves it', async () => {
    const { start, poll, projects, service } = harness()
    const { code } = await start('cursio')
    expect(await poll(code)).toEqual({ status: 200, body: { status: 'pending' } })
    expect(await service.describeConnect(code)).toMatchObject({ app: 'cursio' })
    expect(projects()).toEqual([])
  })

  test('approving creates a project named after the app and hands its keys over once', async () => {
    const { start, poll, service, projects } = harness()
    const { code } = await start('cursio')
    const approval = await service.approveConnect(code, { id: 42 })
    expect(approval).toMatchObject({ ok: true, project: { name: 'cursio' } })

    const first = await poll(code)
    expect(first.status).toBe(200)
    const grant = first.body as unknown as ConnectGrant & { status: string }
    expect(grant.status).toBe('approved')
    expect(grant.project.name).toBe('cursio')
    expect(grant.ingestKey).toMatch(/^bughq_[0-9a-f]{64}$/)
    expect(looksLikeReadKey(grant.readKey)).toBe(true)
    expect(grant.dashboardUrl).toBe(`${ORIGIN}/dashboard?project=${encodeURIComponent(grant.project.id)}`)

    expect(projects()).toEqual([{
      id: grant.project.id,
      name: 'cursio',
      platform: 'stacks',
      ingest_key: grant.ingestKey,
      read_key: grant.readKey,
      owner_id: 42,
    }])

    // Single use: the keys are gone from the wire after the first collection.
    expect(await poll(code)).toEqual({ status: 404, body: { status: 'expired' } })
  })

  test('the keys never rest in the codes table in the clear', async () => {
    const { start, service, db, projects } = harness()
    const { code } = await start('cursio')
    await service.approveConnect(code, { id: 42 })
    const stored = JSON.stringify(db.query('SELECT * FROM hq_connect_codes').all())
    const [project] = projects()
    expect(stored).not.toContain(code)
    expect(stored).not.toContain(String(project!.read_key))
    expect(stored).not.toContain(String(project!.ingest_key))
  })

  test('connecting the same app again reuses the project and its keys', async () => {
    const { connect, projects } = harness()
    const first = await connect('cursio', 42)
    const again = await connect('Cursio', 42)
    expect(again.project.id).toBe(first.project.id)
    expect(again.ingestKey).toBe(first.ingestKey)
    expect(again.readKey).toBe(first.readKey)
    expect(projects()).toHaveLength(1)
  })

  test('a project made in the dashboard is reused, and gets a read key if it had none', async () => {
    const { connect, db, projects } = harness()
    db.query('INSERT INTO projects (id, name, platform, ingest_key, owner_id, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run('acme-web-1a2b3c', 'Acme Web', 'react', 'bughq_existing', 42)
    const grant = await connect('Acme Web', 42)
    expect(grant.project).toEqual({ id: 'acme-web-1a2b3c', name: 'Acme Web' })
    expect(grant.ingestKey).toBe('bughq_existing')
    expect(looksLikeReadKey(grant.readKey)).toBe(true)
    expect(projects()).toHaveLength(1)
    expect(projects()[0]!.platform).toBe('react')
  })

  test('the same app name in two accounts is two projects', async () => {
    const { connect } = harness()
    const mine = await connect('api', 1)
    const theirs = await connect('api', 2)
    expect(theirs.project.id).not.toBe(mine.project.id)
    expect(theirs.readKey).not.toBe(mine.readKey)
  })

  test('an unknown or malformed code is expired', async () => {
    const { poll, service } = harness()
    expect(await poll('a'.repeat(43))).toEqual({ status: 404, body: { status: 'expired' } })
    expect(await poll('nope')).toEqual({ status: 404, body: { status: 'expired' } })
    expect(await service.describeConnect('nope')).toBeNull()
    expect(await service.approveConnect('a'.repeat(43), { id: 1 })).toEqual({ ok: false, reason: 'expired' })
  })

  test('a code expires after ten minutes, approved or not, and then creates nothing', async () => {
    const { start, poll, service, clock, projects } = harness()
    const pending = await start('one')
    const approved = await start('two')
    await service.approveConnect(approved.code, { id: 1 })
    clock.at += 600_001

    expect(await poll(pending.code)).toEqual({ status: 404, body: { status: 'expired' } })
    expect(await poll(approved.code)).toEqual({ status: 404, body: { status: 'expired' } })
    expect(await service.approveConnect(pending.code, { id: 1 })).toEqual({ ok: false, reason: 'expired' })
    expect(projects().map(project => project.name)).toEqual(['two'])
  })

  test('a code cannot be approved twice', async () => {
    const { start, service } = harness()
    const { code } = await start('cursio')
    await service.approveConnect(code, { id: 1 })
    expect(await service.approveConnect(code, { id: 2 })).toEqual({ ok: false, reason: 'already_approved' })
  })

  test('a Free account at its project allowance cannot connect a new app, but can reconnect one it has', async () => {
    const { connect, start, service, projects } = harness()
    for (let i = 0; i < FREE_PROJECTS; i++)
      await connect(`app-${i}`, 9)

    const { code } = await start('one-too-many')
    expect(service.approveConnect(code, { id: 9 })).rejects.toBeInstanceOf(ProjectLimitError)
    expect(projects()).toHaveLength(FREE_PROJECTS)

    const again = await connect('app-0', 9)
    expect(again.project.name).toBe('app-0')
  })

  test('a paid account is not held to the Free project allowance', async () => {
    const { connect, projects } = harness({ pro: [9] })
    for (let i = 0; i <= FREE_PROJECTS; i++)
      await connect(`app-${i}`, 9)
    expect(projects()).toHaveLength(FREE_PROJECTS + 1)
  })
})

describe('GET /api/v1/usage', () => {
  test('answers the account\'s errors this month against the Free allowance', async () => {
    const { connect, usage, counter } = harness()
    const grant = await connect('cursio', 42)
    counter.record(42, ERRORS_METER, 412)
    await counter.flush()

    const { status, body } = await usage(grant.readKey)
    expect(status).toBe(200)
    expect(body).toEqual([{
      meter: 'errors',
      used: 412,
      limit: 500,
      period: '2026-11',
      state: 'warn',
      upgradeUrl: `${ORIGIN}/pricing`,
    } satisfies UsageReport])
  })

  test('counts what has not been flushed yet', async () => {
    const { connect, usage, counter } = harness()
    const grant = await connect('cursio', 42)
    counter.record(42, ERRORS_METER, 3)
    expect((await usage(grant.readKey)).body).toMatchObject([{ used: 3, state: 'ok' }])
  })

  test('reports over, then sampled, past the allowance', async () => {
    const { connect, usage, counter } = harness()
    const grant = await connect('cursio', 42)
    counter.record(42, ERRORS_METER, 500)
    expect((await usage(grant.readKey)).body).toMatchObject([{ used: 500, limit: 500, state: 'over' }])
    counter.record(42, ERRORS_METER, 101)
    expect((await usage(grant.readKey)).body).toMatchObject([{ used: 601, limit: 500, state: 'sampled' }])
  })

  test('a paid account is unlimited', async () => {
    const { connect, usage, counter } = harness({ pro: [42] })
    const grant = await connect('cursio', 42)
    counter.record(42, ERRORS_METER, 9000)
    expect((await usage(grant.readKey)).body).toEqual([{
      meter: 'errors',
      used: 9000,
      limit: null,
      period: '2026-11',
      state: 'ok',
      upgradeUrl: `${ORIGIN}/pricing`,
    }])
  })

  test('the allowance is the account\'s: two of its projects report the same usage', async () => {
    const { connect, usage, counter } = harness()
    const one = await connect('one', 42)
    const two = await connect('two', 42)
    counter.record(42, ERRORS_METER, 50)
    expect((await usage(one.readKey)).body).toEqual((await usage(two.readKey)).body)
  })

  test('refuses no key, a wrong key, the ingest key and a session-shaped token', async () => {
    const { connect, usage } = harness()
    const grant = await connect('cursio', 42)
    for (const key of [undefined, 'not-a-key', grant.ingestKey, `bughq_read_${'0'.repeat(64)}`, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'])
      expect((await usage(key)).status).toBe(401)
  })

  test('a revoked key and an archived project read nothing', async () => {
    const { connect, usage, db } = harness()
    const archived = await connect('archived', 42)
    const revoked = await connect('revoked', 42)
    db.query('UPDATE projects SET is_active = 0 WHERE id = ?').run(archived.project.id)
    db.query('UPDATE projects SET read_key = NULL WHERE id = ?').run(revoked.project.id)
    expect((await usage(archived.readKey)).status).toBe(401)
    expect((await usage(revoked.readKey)).status).toBe(401)
  })
})

describe('the connect routes', () => {
  const routes = readFileSync(resolve(root, 'routes/hq.ts'), 'utf8')

  test('are mounted, at the paths the contract names', () => {
    const registry = readFileSync(resolve(root, 'app/Routes.ts'), 'utf8')
    expect(registry).toContain(`hq: { path: 'hq', prefix: '' }`)
    expect(routes).toContain(`route.post('/api/cli/connect',`)
    expect(routes).toContain(`route.get('/api/cli/connect/{code}',`)
    expect(routes).toContain(`route.get('/api/v1/usage',`)
  })

  test('rate-limit starting a connect, which the package leaves to the router', () => {
    expect(routes).toMatch(/rateLimit\(`connect:\$\{clientIp\(request\)\}`/)
  })

  test('approving needs a signed-in user and a same-origin request', () => {
    const approve = routes.slice(routes.indexOf(`route.post('/api/cli/connect/{code}/approve'`))
    expect(approve.indexOf('sameOrigin(request)')).toBeGreaterThan(-1)
    expect(approve.indexOf('currentUser(request)')).toBeLessThan(approve.indexOf('hq.approveConnect('))
  })

  test('the approve page describes the request and never receives the keys', () => {
    const page = readFileSync(resolve(root, 'resources/views/cli/connect.stx'), 'utf8')
    expect(page).toContain('hq.describeConnect(code)')
    expect(page).toContain('/approve')
    expect(page).not.toMatch(/ingestKey|readKey|read_key|ingest_key/)
    // Copy only: comments may use whatever punctuation they like.
    const copy = page.slice(page.lastIndexOf('</script>'))
    expect(copy).not.toMatch(/[–—]/)
  })
})
