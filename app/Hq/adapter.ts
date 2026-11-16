import type { ConnectCodeStore, ConnectGrant, HqServiceAdapter, ReadPrincipal } from '@stacksjs/hq/service'
import { ERRORS_METER, errorsPerMonth, FREE_PROJECTS } from '../Billing/plans'
import { newIngestKey, newProjectId } from '../Support/project-keys'
import { connectReadKeyName } from '../Support/read-key'

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
  isActive: boolean
}

export interface ProjectStore {
  /** The owner's project of this name, compared case-insensitively. */
  findOwnedByName: (ownerId: number, name: string) => Promise<HqProject | null>
  countOwned: (ownerId: number) => Promise<number>
  create: (project: HqProject & { platform: string }) => Promise<void>
  setIngestKey: (projectId: string, ingestKey: string) => Promise<void>
  /**
   * Mint a read key for the project and answer it. The only time it is ever
   * readable: what is kept is a hash (app/Support/project-tokens.ts).
   */
  issueReadKey: (projectId: string, name: string) => Promise<string>
  /** The project a presented read key reads, or null when it is not a live one. */
  findByReadKey: (readKey: string) => Promise<HqProject | null>
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
        isActive: true,
      }
      await projects.create({ ...project, platform: 'stacks' })
    }

    // A reused project keeps its ingest key, and gets a read key of its own
    // for this connect. A read key is stored hashed, so the one a first
    // machine was given cannot be handed out again; minting another leaves the
    // first machine's deployment working, and each can be revoked alone.
    let { ingestKey } = project
    if (!ingestKey) {
      ingestKey = newIngestKey()
      await projects.setIngestKey(project.id, ingestKey)
    }
    const readKey = await projects.issueReadKey(project.id, connectReadKeyName(app))

    return {
      project: { id: project.id, name: project.name },
      ingestKey,
      readKey,
      dashboardUrl: `${deps.origin()}/dashboard?project=${encodeURIComponent(project.id)}`,
    }
  }

  async function authenticateReadKey(presented: string): Promise<ReadPrincipal | null> {
    // Whether it is a live read key at all is the store's answer: an ingest
    // key, a session token or a key for something else resolves to nothing.
    const project = await projects.findByReadKey(presented)
    if (!project || !project.isActive)
      return null
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
