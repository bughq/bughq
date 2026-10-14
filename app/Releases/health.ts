/**
 * Release health: crash-free sessions per release.
 *
 * Pure helpers for the session ingest and the releases panel. The storage side
 * (app_sessions, see migration 0000000045) only ever escalates a session's
 * status, so the arithmetic here can trust that a crashed session is counted
 * once however many times its device replays the queue.
 */

export type SessionStatus = 'ok' | 'errored' | 'abnormal' | 'crashed'

const RANK: Record<SessionStatus, number> = { ok: 0, errored: 1, abnormal: 2, crashed: 3 }

export function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === 'string' && value in RANK
}

/** The worse of two statuses. A late "ok" never overwrites a crash. */
export function escalate(current: SessionStatus, next: SessionStatus): SessionStatus {
  return RANK[next] > RANK[current] ? next : current
}

/**
 * The SQL twin of `escalate`, for the upsert. Kept beside the TypeScript so the
 * two orders cannot drift: tests/unit/release-health.test.ts checks this string
 * against RANK.
 */
export const ESCALATE_SQL = `CASE
  WHEN app_sessions.status = 'crashed' OR EXCLUDED.status = 'crashed' THEN 'crashed'
  WHEN app_sessions.status = 'abnormal' OR EXCLUDED.status = 'abnormal' THEN 'abnormal'
  WHEN app_sessions.status = 'errored' OR EXCLUDED.status = 'errored' THEN 'errored'
  ELSE 'ok'
END`

/** One session as a device reports it, after validation. */
export interface SessionUpdate {
  id: string
  release: string
  environment: string
  platform: string | null
  status: SessionStatus
  errors: number
  startedAt: string
  userId: string | null
}

const MAX_SESSIONS_PER_REQUEST = 50

function clean(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

/**
 * Validate a `POST /sessions` body: `{ sessions: [...] }` (a replayed offline
 * queue) or a single session object. Malformed entries are skipped, not fatal,
 * so one bad record cannot hold back the rest of a device's queue.
 */
export function parseSessions(body: Record<string, any>, now = new Date()): SessionUpdate[] {
  const list = Array.isArray(body.sessions) ? body.sessions : body.id ? [body] : []
  const out: SessionUpdate[] = []
  for (const raw of list.slice(0, MAX_SESSIONS_PER_REQUEST)) {
    if (!raw || typeof raw !== 'object')
      continue
    const id = clean(raw.id ?? raw.sid, 64)
    if (!/^[\w-]{8,64}$/.test(id))
      continue
    const started = new Date(raw.started_at ?? raw.startedAt ?? now)
    // A clock far in the future is a broken device clock, not a real session.
    const startedAt = Number.isNaN(started.getTime()) || started.getTime() > now.getTime() + 86_400_000 ? now : started
    out.push({
      id,
      release: clean(raw.release ?? body.release, 128),
      environment: clean(raw.environment ?? body.environment ?? 'production', 64) || 'production',
      platform: clean(raw.platform ?? body.platform, 16) || null,
      status: isSessionStatus(raw.status) ? raw.status : 'ok',
      errors: Math.max(0, Math.min(1_000_000, Math.floor(Number(raw.errors ?? 0)) || 0)),
      startedAt: startedAt.toISOString(),
      userId: raw.user_id != null ? clean(raw.user_id, 128) || null : null,
    })
  }
  return out
}

export interface ReleaseHealthRow {
  release: string
  sessions: number
  crashed: number
  abnormal: number
  errored: number
  users: number
  first_seen: string | null
  last_seen: string | null
}

export interface ReleaseHealth extends ReleaseHealthRow {
  /** 0..100, or null when there are no sessions to divide by. */
  crashFreeSessions: number | null
}

/**
 * Crash-free sessions as a percentage, rounded down to two decimals.
 *
 * Rounded DOWN on purpose: 99.996% must not display as 100%, because "100%" is
 * the one number that tells a reader nothing crashed.
 */
export function crashFreeRate(sessions: number, crashed: number): number | null {
  if (!sessions)
    return null
  const rate = Math.max(0, (sessions - Math.min(crashed, sessions)) / sessions) * 100
  return Math.floor(rate * 100) / 100
}

export function withCrashFree(rows: ReleaseHealthRow[]): ReleaseHealth[] {
  return rows.map(r => ({ ...r, crashFreeSessions: crashFreeRate(Number(r.sessions), Number(r.crashed)) }))
}
