import type { SqlClient, SqlDialect, UsageCounter } from '@stacksjs/hq/meter'
import type { ConnectCodeStore, ConnectGrant, HqServiceAdapter, ReadPrincipal } from '@stacksjs/hq/service'
import { sqlConnectCodeStore } from '@stacksjs/hq/service'
import { ERRORS_METER, errorsLimitFor, FREE_PROJECTS } from '../Billing/limits'
import { newIngestKey, newProjectId } from '../Support/projects'
import { looksLikeReadKey, newReadKey, sameKey } from '../Support/read-key'

/**
 * BugHQ's side of the contract every HQ service answers the same way
 * (`@stacksjs/hq/service`): what `buddy hq:connect` and `buddy hq:status` talk
 * to.
 *
 *   POST /api/cli/connect          -> { code, approveUrl }
 *   GET  /api/cli/connect/{code}   -> pending | { project, ingestKey, readKey, dashboardUrl }
 *   GET  /api/v1/usage  (read key) -> [{ meter, used, limit, period, state, upgradeUrl }]
 *
 * The package owns the protocol: codes, hashing, sealing the keys, single use.
 * This file owns only what is BugHQ's: which project an app name means, what
 * its keys are, and how much of the allowance an account has used. Accounts
 * stay BugHQ's. Nothing here knows about another service or a shared login.
 *
 * Everything it touches is passed in, so the same adapter runs against
 * Postgres in the app and against an in-memory database in the tests,
 * including the package's own contract suite.
 */

/** The signed-in person approving a connect. `Auth.getUserFromToken` answers this shape. */
export interface HqUser {
  id: number | string
}

/** Thrown by `provision` when a Free account has no project slot left for a new app. */
export class ProjectLimitError extends Error {
  readonly limit: number

  constructor(limit: number) {
    super(`Free includes ${limit} project${limit === 1 ? '' : 's'}. Upgrade to Pro for unlimited projects.`)
    this.name = 'ProjectLimitError'
    this.limit = limit
  }
}

export interface BughqAdapterDeps {
  /** `db` from `@stacksjs/database`, or anything else with `unsafe(sql, params)`. */
  sql: SqlClient
  dialect?: SqlDialect
  /** Defaults to the SQL store over `hq_connect_codes`. */
  codes?: ConnectCodeStore
  counter: Pick<UsageCounter, 'read'>
  isPro: (ownerId: number | null | undefined) => Promise<boolean>
  /** The public web origin, no trailing slash. */
  appUrl: () => string
}

type Row = Record<string, unknown>

/**
 * Run one statement and answer its rows. `db.unsafe` answers a promise of
 * rows; other clients answer `{ rows }` or a statement with `execute()`.
 */
async function rows(client: SqlClient, sql: string, params: unknown[]): Promise<Row[]> {
  const statement = client.unsafe(sql, params) as { execute?: () => Promise<unknown> } | PromiseLike<unknown> | null | undefined
  const result = statement && typeof (statement as { execute?: unknown }).execute === 'function'
    ? await (statement as { execute: () => Promise<unknown> }).execute()
    : await statement
  if (Array.isArray(result))
    return result as Row[]
  const inner = (result as { rows?: unknown } | null | undefined)?.rows
  return Array.isArray(inner) ? inner as Row[] : []
}

/** `projects.owner_id` as the meter's owner. Only an all-digits owner is an account. */
function accountId(owner: string): number | null {
  return /^\d{1,15}$/.test(owner) ? Number(owner) : null
}

export function createBughqAdapter(deps: BughqAdapterDeps): HqServiceAdapter<HqUser> {
  const { sql } = deps
  const origin = (): string => deps.appUrl().replace(/\/+$/, '')

  async function projectNamed(ownerId: number, app: string): Promise<Row | null> {
    // lower() on both sides, like the create-app API: "Acme" and "acme" are
    // the same app to the person who typed them.
    return (await rows(
      sql,
      'SELECT id, name, ingest_key, read_key FROM projects WHERE owner_id = $1 AND lower(name) = lower($2) ORDER BY created_at ASC, id ASC LIMIT 1',
      [ownerId, app],
    ))[0] ?? null
  }

  /**
   * Create, or reuse, the project named after the app and answer its keys.
   *
   * Safe to repeat: connecting the same app twice lands on the same project
   * with the same keys, so an app that already has them in its `.env` keeps
   * working after somebody runs the command again.
   */
  async function provision(user: HqUser, { app }: { app: string }): Promise<ConnectGrant> {
    const ownerId = Number(user.id)
    if (!Number.isFinite(ownerId))
      throw new TypeError('A connect can only be approved by a signed-in user.')

    let project = await projectNamed(ownerId, app)

    if (!project) {
      // The same gate as the create-app API (routes/projects.ts). A terminal
      // must not be a way around an allowance the dashboard enforces.
      if (!(await deps.isPro(ownerId))) {
        const owned = Number((await rows(sql, 'SELECT COUNT(*) AS n FROM projects WHERE owner_id = $1', [ownerId]))[0]?.n ?? 0)
        if (owned >= FREE_PROJECTS)
          throw new ProjectLimitError(FREE_PROJECTS)
      }
      const id = newProjectId(app)
      await rows(
        sql,
        'INSERT INTO projects (id, name, platform, ingest_key, read_key, owner_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, app, 'stacks', newIngestKey(), newReadKey(), ownerId, true],
      )
      project = await projectNamed(ownerId, app)
    }
    if (!project)
      throw new Error('Could not create the project.')

    let readKey = project.read_key == null ? '' : String(project.read_key)
    if (!looksLikeReadKey(readKey)) {
      // An existing project that never had a read key issued. Guarded on the
      // column still being empty, then read back, so two approvals racing
      // agree on one key instead of each handing out its own.
      await rows(
        sql,
        'UPDATE projects SET read_key = $1, read_key_last_used_at = NULL WHERE id = $2 AND read_key IS NULL',
        [newReadKey(), String(project.id)],
      )
      readKey = String((await rows(sql, 'SELECT read_key FROM projects WHERE id = $1 LIMIT 1', [String(project.id)]))[0]?.read_key ?? '')
    }
    if (!looksLikeReadKey(readKey))
      throw new Error('Could not issue a read key for the project.')

    const id = String(project.id)
    return {
      project: { id, name: String(project.name ?? app) },
      ingestKey: String(project.ingest_key ?? ''),
      readKey,
      dashboardUrl: `${origin()}/dashboard?project=${encodeURIComponent(id)}`,
    }
  }

  /**
   * Who a presented read key speaks for, or `null`.
   *
   * The shape is checked first, so an ingest key (public, shipped in client
   * bundles) or a person's session token never reaches the query. The row is
   * found by the key and then compared again in constant time: the index
   * lookup narrows to one candidate, `sameKey` is what decides.
   */
  async function authenticateReadKey(presented: string): Promise<ReadPrincipal | null> {
    if (!looksLikeReadKey(presented))
      return null
    const project = (await rows(sql, 'SELECT id, owner_id, read_key, is_active FROM projects WHERE read_key = $1 LIMIT 1', [presented]))[0]
    if (!project || !looksLikeReadKey(project.read_key) || !sameKey(presented, project.read_key))
      return null
    // An archived project's key reads nothing, the same as on the issue endpoints.
    if (project.is_active === false || project.is_active === 0)
      return null
    return { owner: project.owner_id == null ? '' : String(project.owner_id), project: String(project.id) }
  }

  return {
    service: 'bughq',
    approveUrl: code => `${origin()}/cli/connect?code=${encodeURIComponent(code)}`,
    upgradeUrl: () => `${origin()}/pricing`,
    codes: deps.codes ?? sqlConnectCodeStore(sql, { dialect: deps.dialect ?? 'postgres' }),
    provision,
    authenticateReadKey,
    /**
     * One meter: errors stored this month, against the ACCOUNT's allowance.
     * The allowance is per account, so every project an account owns reports
     * the same number. A project with no owner is not metered.
     */
    async usage(principal) {
      const owner = accountId(principal.owner)
      if (owner === null)
        return [{ meter: ERRORS_METER, used: 0, limit: null }]
      return [{
        meter: ERRORS_METER,
        used: await deps.counter.read(owner, ERRORS_METER),
        limit: errorsLimitFor(await deps.isPro(owner) ? 'pro' : 'free'),
      }]
    },
  }
}
