import { db } from '@stacksjs/database'

/**
 * Per-account monthly event metering.
 *
 * The constraint that shapes everything here: this runs on `POST /errors`, the
 * busiest endpoint in the app, which currently costs three database round-trips
 * per event. Metering must add ZERO. So `record()` mutates a Map and returns,
 * and a timer folds the accumulated deltas into Postgres every ten seconds.
 *
 * The flush is an upsert whose SET is `accepted = usage_counters.accepted +
 * EXCLUDED.accepted` — a server-side add, so any number of app instances
 * converge on the same total rather than overwriting each other. Its RETURNING
 * clause doubles as the read: the flusher is also what refreshes the cached
 * totals, so nothing anywhere issues a separate SELECT to find out where an
 * account stands.
 *
 * A lost flush — SIGKILL, a crash — costs at most ten seconds of counts, not
 * the month, because the durable total already lives in the table.
 */

interface Pending { accepted: number, rejected: number }

/** Deltas not yet folded into Postgres, keyed by owner id. */
const pending = new Map<number, Pending>()

/** Last known durable totals, refreshed by the flusher's RETURNING. */
const known = new Map<number, { period: string, accepted: number, rejected: number }>()

const FLUSH_MS = 10_000

/** 'YYYY-MM' in UTC. Taken from the ISO string the ingest has already built. */
export function periodOf(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * Note one event against an account. Costs a Map lookup and an addition.
 *
 * `ownerId` may be null for a project with no owner; those events are simply
 * not metered rather than being attributed to a made-up account.
 */
export function record(ownerId: number | null | undefined, kind: 'accepted' | 'rejected' = 'accepted'): void {
  if (ownerId == null || !Number.isFinite(Number(ownerId)))
    return
  const id = Number(ownerId)
  const p = pending.get(id) ?? { accepted: 0, rejected: 0 }
  p[kind] += 1
  pending.set(id, p)
}

/**
 * What we last knew this account had used this period, plus anything buffered
 * since. Never queries — a caller on a request path must not pay for a read.
 * Returns null when nothing has been recorded yet, which callers should treat
 * as "no reason to act", not as zero.
 */
export function usageOf(ownerId: number | null | undefined, period: string): { accepted: number, rejected: number } | null {
  if (ownerId == null)
    return null
  const id = Number(ownerId)
  const k = known.get(id)
  const p = pending.get(id)
  if (!k && !p)
    return null
  const base = k && k.period === period ? k : { accepted: 0, rejected: 0 }
  return {
    accepted: base.accepted + (p?.accepted ?? 0),
    rejected: base.rejected + (p?.rejected ?? 0),
  }
}

/**
 * Fold buffered deltas into Postgres. Safe to call concurrently with `record`:
 * each owner's delta is removed from `pending` before the write, so events
 * arriving mid-flush accumulate into a fresh entry rather than being lost or
 * double-counted.
 */
export async function flush(period = periodOf(new Date().toISOString())): Promise<void> {
  if (pending.size === 0)
    return
  // Snapshot and clear first. If the write then fails, those counts are gone —
  // deliberately. Re-queueing them would let a sustained outage grow the buffer
  // without bound on the hottest path in the app, and ten seconds of counts is
  // a far cheaper loss than unbounded memory.
  const batch = [...pending.entries()]
  pending.clear()

  for (const [ownerId, delta] of batch) {
    if (!delta.accepted && !delta.rejected)
      continue
    try {
      const row = (await db.unsafe(
        `INSERT INTO usage_counters (owner_id, period, accepted, rejected, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (owner_id, period) DO UPDATE
           SET accepted = usage_counters.accepted + EXCLUDED.accepted,
               rejected = usage_counters.rejected + EXCLUDED.rejected,
               updated_at = NOW()
         RETURNING accepted, rejected`,
        [ownerId, period, delta.accepted, delta.rejected],
      ))?.[0]
      if (row) {
        known.set(ownerId, {
          period,
          accepted: Number(row.accepted ?? 0),
          rejected: Number(row.rejected ?? 0),
        })
      }
    }
    catch (err) {
      console.error('[usage] flush failed for owner', ownerId, err instanceof Error ? err.message : err)
    }
  }
}

/** Durable total for an account, for surfaces that may pay for a query. */
export async function readUsage(ownerId: number, period: string): Promise<{ accepted: number, rejected: number }> {
  try {
    const row = (await db.unsafe(
      'SELECT accepted, rejected FROM usage_counters WHERE owner_id = $1 AND period = $2 LIMIT 1',
      [ownerId, period],
    ))?.[0]
    const base = { accepted: Number(row?.accepted ?? 0), rejected: Number(row?.rejected ?? 0) }
    const p = pending.get(ownerId)
    return p ? { accepted: base.accepted + p.accepted, rejected: base.rejected + p.rejected } : base
  }
  catch {
    return { accepted: 0, rejected: 0 }
  }
}

const timer = setInterval(() => {
  flush().catch(err => console.error('[usage] flush error:', err instanceof Error ? err.message : err))
}, FLUSH_MS)
// Never hold the process open for a counter.
if (typeof timer === 'object' && timer && 'unref' in timer)
  (timer as { unref: () => void }).unref()

// A clean shutdown should not lose the last window. Best-effort: if the write
// cannot finish before the process goes, the loss is bounded at ten seconds.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  try {
    process.on(signal, () => { void flush() })
  }
  catch { /* not all runtimes allow signal handlers */ }
}
