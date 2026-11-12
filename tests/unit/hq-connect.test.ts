import type { ConnectGrant, UsageReport } from '@stacksjs/hq/service'
import type { HqProject, HqUser, ProjectStore } from '../../app/Hq/adapter'
import { describe, expect, test } from 'bun:test'
import { createHqService, createMemoryConnectCodeStore } from '@stacksjs/hq/service'
import { hqServiceContract } from '@stacksjs/hq/testing'
import { FREE_PROJECTS } from '../../app/Billing/plans'
import { ConnectRefusedError, createBughqAdapter } from '../../app/Hq/adapter'
import { looksLikeReadKey } from '../../app/Support/read-key'

const ORIGIN = 'https://bughq.test'

/** The `projects` table, as much of it as the adapter touches. */
function memoryProjects(seed: HqProject[] = []): ProjectStore & { rows: HqProject[], touched: string[] } {
  const rows = seed.map(project => ({ ...project }))
  const touched: string[] = []
  const byId = (id: string) => rows.find(project => project.id === id)
  return {
    rows,
    touched,
    async findOwnedByName(ownerId, name) {
      const found = rows.find(project => project.ownerId === ownerId && project.name.toLowerCase() === name.toLowerCase())
      return found ? { ...found } : null
    },
    async countOwned(ownerId) {
      return rows.filter(project => project.ownerId === ownerId).length
    },
    async create({ platform: _platform, ...project }) {
      rows.push({ ...project })
    },
    async setReadKey(projectId, readKey) {
      byId(projectId)!.readKey = readKey
    },
    async setIngestKey(projectId, ingestKey) {
      byId(projectId)!.ingestKey = ingestKey
    },
    async findByReadKey(readKey) {
      const found = rows.find(project => project.readKey === readKey)
      return found ? { ...found } : null
    },
    async touchReadKey(projectId) {
      touched.push(projectId)
    },
  }
}

function setup(options: { projects?: HqProject[], pro?: number[], used?: Record<number, number> } = {}) {
  const projects = memoryProjects(options.projects)
  const pro = new Set(options.pro ?? [])
  const used = options.used ?? {}
  const adapter = createBughqAdapter({
    projects,
    codes: createMemoryConnectCodeStore(),
    origin: () => ORIGIN,
    isPro: async ownerId => pro.has(ownerId),
    errorsUsed: async ownerId => used[ownerId] ?? 0,
  })
  const clock = { at: Date.parse('2026-03-10T12:00:00.000Z') }
  const service = createHqService(adapter, { now: () => new Date(clock.at) })

  const call = async (path: string, init: { method?: string, body?: unknown, headers?: Record<string, string> } = {}) => {
    const response = await service.handle(new Request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }))
    return { status: response!.status, body: await response!.json() as any }
  }
  const start = async (app: string) => (await call('/api/cli/connect', { method: 'POST', body: { app } })).body as { code: string, approveUrl: string }
  const connect = async (app: string, user: HqUser): Promise<ConnectGrant> => {
    const { code } = await start(app)
    await service.approveConnect(code, user)
    return (await call(`/api/cli/connect/${code}`)).body
  }
  const usage = (key?: string) => call('/api/v1/usage', { headers: key ? { Authorization: `Bearer ${key}` } : undefined })

  return { projects, adapter, service, clock, call, start, connect, usage }
}

const ALICE: HqUser = { id: 1 }
const BOB: HqUser = { id: 2 }

// The package's own suite, against BugHQ's adapter rather than the in-memory
// reference one: codes hashed at rest, single use under concurrent polls,
// expiry, project reuse, read-key refusal and the usage shape.
hqServiceContract('bughq', () => ({ adapter: setup().adapter, user: ALICE }))

describe('connect flow', () => {
  test('a new code is pending and points at this service\'s approve page', async () => {
    const { start, call, service } = setup()
    const { code, approveUrl } = await start('cursio')
    expect(approveUrl).toBe(`${ORIGIN}/cli/connect?code=${code}`)
    expect(await call(`/api/cli/connect/${code}`)).toEqual({ status: 200, body: { status: 'pending' } })
    expect(await service.describeConnect(code)).toMatchObject({ app: 'cursio' })
  })

  test('approving creates a project named after the app and hands over its keys once', async () => {
    const { start, call, service, projects } = setup()
    const { code } = await start('cursio')
    expect(await service.approveConnect(code, ALICE)).toEqual({ ok: true, project: { id: projects.rows[0]!.id, name: 'cursio' } })

    const first = await call(`/api/cli/connect/${code}`)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({
      status: 'approved',
      project: { id: projects.rows[0]!.id, name: 'cursio' },
      ingestKey: projects.rows[0]!.ingestKey,
      readKey: projects.rows[0]!.readKey,
      dashboardUrl: `${ORIGIN}/dashboard?project=${projects.rows[0]!.id}`,
    })
    expect(first.body.ingestKey).toMatch(/^bughq_[0-9a-f]{64}$/)
    expect(looksLikeReadKey(first.body.readKey)).toBe(true)
    expect(projects.rows[0]).toMatchObject({ ownerId: 1, isActive: true })

    expect(await call(`/api/cli/connect/${code}`)).toEqual({ status: 404, body: { status: 'expired' } })
  })

  test('a code that is never approved expires', async () => {
    const { start, call, service, clock, projects } = setup()
    const { code } = await start('cursio')
    clock.at += 10 * 60_000 + 1
    expect(await call(`/api/cli/connect/${code}`)).toEqual({ status: 404, body: { status: 'expired' } })
    expect(await service.approveConnect(code, ALICE)).toEqual({ ok: false, reason: 'expired' })
    expect(await service.describeConnect(code)).toBeNull()
    expect(projects.rows).toEqual([])
  })

  test('an unknown code is expired, and nothing is created for it', async () => {
    const { call, service, projects } = setup()
    expect(await call(`/api/cli/connect/${'x'.repeat(43)}`)).toEqual({ status: 404, body: { status: 'expired' } })
    expect(await call('/api/cli/connect/short')).toEqual({ status: 404, body: { status: 'expired' } })
    expect(await service.approveConnect('x'.repeat(43), ALICE)).toEqual({ ok: false, reason: 'expired' })
    expect(projects.rows).toEqual([])
  })

  test('connecting an app that already exists reuses the project and keeps its keys', async () => {
    const { connect, projects } = setup()
    const first = await connect('Cursio', ALICE)
    // A second machine, and a different capitalisation of the same name.
    const second = await connect('cursio', ALICE)
    expect(projects.rows).toHaveLength(1)
    expect(second.project).toEqual(first.project)
    expect(second.ingestKey).toBe(first.ingestKey)
    // Not rotated: the first machine's deployment is still reading with it.
    expect(second.readKey).toBe(first.readKey)
  })

  test('a project made in the dashboard, with no read key yet, is issued one', async () => {
    const existing: HqProject = { id: 'cursio-abc123', name: 'cursio', ownerId: 1, ingestKey: 'bughq_existing', readKey: null, isActive: true }
    const { connect, projects } = setup({ projects: [existing] })
    const grant = await connect('cursio', ALICE)
    expect(grant.project.id).toBe('cursio-abc123')
    expect(grant.ingestKey).toBe('bughq_existing')
    expect(looksLikeReadKey(grant.readKey)).toBe(true)
    expect(projects.rows[0]!.readKey).toBe(grant.readKey)
  })

  test('two accounts connecting the same app name get separate projects', async () => {
    const { connect, projects } = setup()
    const mine = await connect('api', ALICE)
    const theirs = await connect('api', BOB)
    expect(projects.rows).toHaveLength(2)
    expect(theirs.project.id).not.toBe(mine.project.id)
    expect(theirs.readKey).not.toBe(mine.readKey)
  })

  test('a Free account at its project allowance is refused, and the code stays pending', async () => {
    const full = Array.from({ length: FREE_PROJECTS }, (_, i): HqProject => ({ id: `p${i}`, name: `app ${i}`, ownerId: 1, ingestKey: `k${i}`, readKey: null, isActive: true }))
    const { start, service, projects, call } = setup({ projects: full })
    const { code } = await start('one-more')
    const refusal = await service.approveConnect(code, ALICE).catch(error => error)
    expect(refusal).toBeInstanceOf(ConnectRefusedError)
    expect((refusal as ConnectRefusedError).reason).toBe('project_limit')
    expect(projects.rows).toHaveLength(FREE_PROJECTS)
    expect(await call(`/api/cli/connect/${code}`)).toEqual({ status: 200, body: { status: 'pending' } })
  })

  test('the allowance gates new projects only: reusing one is always allowed, and Pro is not capped', async () => {
    const full = Array.from({ length: FREE_PROJECTS }, (_, i): HqProject => ({ id: `p${i}`, name: `app ${i}`, ownerId: 1, ingestKey: `k${i}`, readKey: null, isActive: true }))
    const free = setup({ projects: full })
    expect((await free.connect('app 0', ALICE)).project.id).toBe('p0')

    const pro = setup({ projects: full, pro: [1] })
    expect((await pro.connect('one-more', ALICE)).project.name).toBe('one-more')
    expect(pro.projects.rows).toHaveLength(FREE_PROJECTS + 1)
  })

  test('an archived project is not handed out', async () => {
    const archived: HqProject = { id: 'old', name: 'cursio', ownerId: 1, ingestKey: 'bughq_old', readKey: null, isActive: false }
    const { start, service } = setup({ projects: [archived] })
    const { code } = await start('cursio')
    const refusal = await service.approveConnect(code, ALICE).catch(error => error)
    expect((refusal as ConnectRefusedError).reason).toBe('project_archived')
  })
})

describe('GET /api/v1/usage', () => {
  test('a Free account sees its count against the 500 allowance', async () => {
    const { connect, usage, projects } = setup({ used: { 1: 412 } })
    const grant = await connect('cursio', ALICE)
    const { status, body } = await usage(grant.readKey)
    expect(status).toBe(200)
    expect(body).toEqual([{ meter: 'errors', used: 412, limit: 500, period: '2026-03', state: 'warn', upgradeUrl: `${ORIGIN}/pricing` }] satisfies UsageReport[])
    expect(projects.touched).toEqual([grant.project.id])
  })

  test('reports over and sampled the way the ingest decides them', async () => {
    const over = setup({ used: { 1: 560 } })
    expect((await over.usage((await over.connect('a', ALICE)).readKey)).body[0]).toMatchObject({ used: 560, limit: 500, state: 'over' })
    const sampled = setup({ used: { 1: 640 } })
    expect((await sampled.usage((await sampled.connect('a', ALICE)).readKey)).body[0]).toMatchObject({ used: 640, limit: 500, state: 'sampled' })
  })

  test('a Pro account is unlimited', async () => {
    const { connect, usage } = setup({ pro: [1], used: { 1: 90_000 } })
    const { body } = await usage((await connect('cursio', ALICE)).readKey)
    expect(body).toEqual([{ meter: 'errors', used: 90_000, limit: null, period: '2026-03', state: 'ok', upgradeUrl: `${ORIGIN}/pricing` }])
  })

  test('usage is the account\'s, so every project of one owner reports the same total', async () => {
    const { connect, usage } = setup({ used: { 1: 300, 2: 5 } })
    const web = await connect('web', ALICE)
    const api = await connect('api', ALICE)
    const other = await connect('web', BOB)
    expect((await usage(web.readKey)).body[0].used).toBe(300)
    expect((await usage(api.readKey)).body[0].used).toBe(300)
    expect((await usage(other.readKey)).body[0].used).toBe(5)
  })

  test('refuses no key, the ingest key, a session-shaped token and a revoked or archived project', async () => {
    const { connect, usage, projects } = setup()
    const grant = await connect('cursio', ALICE)
    expect((await usage()).status).toBe(401)
    expect((await usage(grant.ingestKey)).status).toBe(401)
    expect((await usage('eyJhbGciOiJIUzI1NiJ9.e30.signature')).status).toBe(401)
    expect((await usage(`bughq_read_${'0'.repeat(64)}`)).status).toBe(401)
    expect((await usage(grant.readKey)).status).toBe(200)

    projects.rows[0]!.isActive = false
    expect((await usage(grant.readKey)).status).toBe(401)
    projects.rows[0]!.isActive = true
    projects.rows[0]!.readKey = null
    expect((await usage(grant.readKey)).status).toBe(401)
  })
})
