import type { SessionUpdate } from './health'
import { createHash } from 'node:crypto'
import { db } from '@stacksjs/database'
import { ESCALATE_SQL } from './health'

export { parseSessions } from './health'

/**
 * Write session updates, one upsert per session.
 *
 * The status only escalates (see ESCALATE_SQL), `errors` accumulates, and the
 * earliest `started_at` wins, so a device replaying its offline queue in any
 * order converges on the same row. The user id is stored only as a hash: the
 * table needs to count distinct users, never to name one.
 */
export async function recordSessions(projectId: string, sessions: SessionUpdate[]): Promise<void> {
  for (const s of sessions) {
    const userHash = s.userId ? createHash('sha256').update(`${projectId}:${s.userId}`).digest('hex') : null
    await db.unsafe(
      `INSERT INTO app_sessions (project_id, id, release, environment, platform, status, errors, user_hash, started_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (project_id, id) DO UPDATE SET
         status      = ${ESCALATE_SQL},
         errors      = app_sessions.errors + EXCLUDED.errors,
         release     = CASE WHEN app_sessions.release = '' THEN EXCLUDED.release ELSE app_sessions.release END,
         platform    = COALESCE(app_sessions.platform, EXCLUDED.platform),
         user_hash   = COALESCE(app_sessions.user_hash, EXCLUDED.user_hash),
         started_at  = LEAST(app_sessions.started_at, EXCLUDED.started_at),
         updated_at  = NOW()`,
      [projectId, s.id, s.release, s.environment, s.platform, s.status, s.errors, userHash, s.startedAt],
    )
  }
}
