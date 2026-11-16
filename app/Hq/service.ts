import type { HqProject, ProjectStore } from './adapter'
import { db } from '@stacksjs/database'
import { createHqService, sqlConnectCodeStore } from '@stacksjs/hq/service'
import { usageCounter } from '../Billing/meter'
import { ERRORS_METER } from '../Billing/plans'
import { isPro } from '../Billing/pro'
import { mintProjectToken, PROJECT_SCOPES, projectForToken } from '../Support/project-tokens'
import { appUrl } from '../Support/urls'
import { createBughqAdapter } from './adapter'

/**
 * The HQ service wired to this app's database. routes/hq.ts mounts its three
 * endpoints and the approve page (resources/views/cli/connect.stx) calls
 * `describeConnect`. The table behind the codes is created by 0000000048.
 */

const COLUMNS = 'id, name, owner_id, ingest_key, is_active'

function toProject(row: Record<string, any> | null | undefined): HqProject | null {
  if (!row)
    return null
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    ownerId: row.owner_id == null ? null : Number(row.owner_id),
    ingestKey: row.ingest_key == null ? null : String(row.ingest_key),
    // sqlite hands booleans back as 0/1.
    isActive: !(row.is_active === false || row.is_active === 0),
  }
}

export const sqlProjectStore: ProjectStore = {
  async findOwnedByName(ownerId, name) {
    // lower(), not ILIKE, and oldest first: the same comparison the create-app
    // endpoint refuses a duplicate with, so there is at most one in practice.
    return toProject((await db.unsafe(
      `SELECT ${COLUMNS} FROM projects WHERE owner_id = $1 AND lower(name) = lower($2) ORDER BY created_at ASC NULLS LAST, id LIMIT 1`,
      [ownerId, name],
    ))?.[0])
  },
  async countOwned(ownerId) {
    return Number((await db.unsafe('SELECT COUNT(*) AS n FROM projects WHERE owner_id = $1', [ownerId]))?.[0]?.n ?? 0)
  },
  async create(project) {
    await db.insertInto('projects').values({
      id: project.id,
      name: project.name,
      platform: project.platform,
      ingest_key: project.ingestKey,
      owner_id: project.ownerId,
      is_active: true,
    }).execute()
  },
  async setIngestKey(projectId, ingestKey) {
    await db.unsafe('UPDATE projects SET ingest_key = $1, updated_at = NOW() WHERE id = $2', [ingestKey, projectId])
  },
  async issueReadKey(projectId, name) {
    return (await mintProjectToken(projectId, PROJECT_SCOPES.read, name)).token
  },
  async findByReadKey(readKey) {
    const target = await projectForToken(readKey, PROJECT_SCOPES.read)
    if (!target)
      return null
    return toProject((await db.unsafe(`SELECT ${COLUMNS} FROM projects WHERE id = $1 LIMIT 1`, [target.projectId]))?.[0])
  },
}

export const bughqAdapter = createBughqAdapter({
  projects: sqlProjectStore,
  codes: sqlConnectCodeStore(db, { dialect: 'postgres' }),
  origin: appUrl,
  isPro,
  errorsUsed: ownerId => usageCounter.read(ownerId, ERRORS_METER),
})

export const hq = createHqService(bughqAdapter)
