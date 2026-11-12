import type { ConnectCodeStore, ConnectGrant, HqServiceAdapter, ReadPrincipal } from '@stacksjs/hq/service'
import { ERRORS_METER, errorsPerMonth, FREE_PROJECTS } from '../Billing/plans'
import { newIngestKey, newProjectId } from '../Support/project-keys'
import { looksLikeReadKey, newReadKey, sameKey } from '../Support/read-key'

/**
 * BugHQ's side of the HQ connect contract (`@stacksjs/hq/service`).
 *
 * `buddy hq:connect` asks for a code, a signed-in person approves it on
 * /cli/connect, and the CLI collects the project's keys. The package owns the
 * codes and the wire format; this file owns what they mean here: which
 * project, which keys, and what a read key may see.
 *
 * Nothing in this file touches the database. It is handed a `ProjectStore`,
 * which is what lets the package's contract suite run against the same code
 * the routes use (tests/unit/hq-connect.test.ts).
 */

export interface HqProject {
  id: string
  name: string
  ownerId: number | null
  ingestKey: string | null
  readKey: string | null
  isActive: boolean
}

export interface ProjectStore {
  /** The owner's project of this name, compared case-insensitively. */
  findOwnedByName: (ownerId: number, name: string) => Promise<HqProject | null>
  countOwned: (ownerId: number) => Promise<number>
  create: (project: HqProject & { platform: string }) => Promise<void>
  setReadKey: (projectId: string, readKey: string) => Promise<void>
  setIngestKey: (projectId: string, ingestKey: string) => Promise<void>
  findByReadKey: (readKey: string) => Promise<HqProject | null>
  /** Note that the key was used. Optional bookkeeping; must not throw. */
  touchReadKey?: (projectId: string) => Promise<void>
}

/** The signed-in person approving a connect. */
export interface HqUser {
  id: number | string
}

export type ConnectRefusal = 'project_limit' | 'project_archived'

/** A connect the account is not allowed to complete, with a sentence for the page. */
export class ConnectRefusedError extends Error {
  readonly reason: ConnectRefusal

  constructor(reason: ConnectRefusal, message: string) {
    super(message)
    this.name = 'ConnectRefusedError'
    this.reason = reason
  }
}

export interface BughqAdapterDeps {
  projects: ProjectStore
  codes: ConnectCodeStore
  /** Public web origin, no trailing slash. */
  origin: () => string
  isPro: (ownerId: number) => Promise<boolean>
  /** Errors stored for this account in the current period. */
  errorsUsed: (ownerId: number) => Promise<number>
}

export function createBughqAdapter(deps: BughqAdapterDeps): HqServiceAdapter<HqUser> {
  const { projects } = deps

  async function provision(user: HqUser, { app }: { app: string }): Promise<ConnectGrant> {
    const ownerId = Number(user.id)
    if (!Number.isFinite(ownerId))
      throw new TypeError('A connect can only be approved by a signed-in user.')

    let project = await projects.findOwnedByName(ownerId, app)
    if (project && !project.isActive) {
      // Its keys are refused by the ingest (app/Errors/ingest.ts). Handing
      // them over would connect an app to a project that drops everything.
      throw new ConnectRefusedError('project_archived', `Your app "${project.name}" is archived. Restore it in Settings, then connect again.`)
    }

    if (!project) {
      // The same gate as POST /api/projects: checked on create, never on use.
      if (!(await deps.isPro(ownerId)) && await projects.countOwned(ownerId) >= FREE_PROJECTS)
        throw new ConnectRefusedError('project_limit', `Free includes ${FREE_PROJECTS} project${Number(FREE_PROJECTS) === 1 ? '' : 's'}. Upgrade to Pro for unlimited projects.`)

      project = {
        id: newProjectId(app),
        name: app,
        ownerId,
        ingestKey: newIngestKey(),
        readKey: newReadKey(),
        isActive: true,
      }
      await projects.create({ ...project, platform: 'stacks' })
    }

    // A reused project keeps the keys it has. Connecting a second machine must
    // not rotate the read key out from under the first one's deployment.
    let { ingestKey, readKey } = project
    if (!ingestKey) {
      ingestKey = newIngestKey()
      await projects.setIngestKey(project.id, ingestKey)
    }
    if (!looksLikeReadKey(readKey)) {
      readKey = newReadKey()
      await projects.setReadKey(project.id, readKey)
    }

    return {
      project: { id: project.id, name: project.name },
      ingestKey,
      readKey,
      dashboardUrl: `${deps.origin()}/dashboard?project=${encodeURIComponent(project.id)}`,
    }
  }

  async function authenticateReadKey(presented: string): Promise<ReadPrincipal | null> {
    // Shape first: an ingest key, a session token or anything else never
    // reaches the lookup, so none of them can be tried as a read key.
    if (!looksLikeReadKey(presented))
      return null
    const project = await projects.findByReadKey(presented)
    if (!project || !project.isActive || !looksLikeReadKey(project.readKey) || !sameKey(presented, project.readKey))
      return null
    await projects.touchReadKey?.(project.id).catch(() => {})
    // Usage is the ACCOUNT's, so the owner is the principal. A project with no
    // owner is not metered; the empty owner reads as exactly that below.
    return { owner: project.ownerId == null ? '' : String(project.ownerId), project: project.id }
  }

  return {
    service: 'bughq',
    approveUrl: code => `${deps.origin()}/cli/connect?code=${encodeURIComponent(code)}`,
    upgradeUrl: () => `${deps.origin()}/pricing`,
    codes: deps.codes,
    provision,
    authenticateReadKey,
    async usage(principal) {
      const ownerId = Number(principal.owner)
      if (principal.owner === '' || !Number.isFinite(ownerId))
        return [{ meter: ERRORS_METER, used: 0, limit: null }]
      const [used, pro] = await Promise.all([deps.errorsUsed(ownerId), deps.isPro(ownerId)])
      return [{ meter: ERRORS_METER, used, limit: errorsPerMonth(pro) }]
    },
  }
}
