import type { SqlDialect } from '@stacksjs/hq/meter'
import { db } from '@stacksjs/database'
import { createCounter, sqlCounterStore } from '@stacksjs/hq/meter'

/**
 * Per-account monthly usage counting, on `@stacksjs/hq/meter`.
 *
 * This used to be a counter of its own. The package's `createCounter` is that
 * counter generalised, with the property that shaped the original intact:
 * counting runs on `POST /errors`, the busiest endpoint in the app, and adds
 * ZERO database round-trips there. `admit` and `record` touch a Map and
 * return; a timer folds the buffered deltas into the table every ten seconds
 * with an additive upsert, so any number of app instances converge on one
 * total. A lost flush costs at most ten seconds of counts, not the month.
 *
 * ## The table
 *
 * `hq_usage_counters(owner, meter, period, used)`, created by migration
 * 0000000047. It is NOT `usage_counters`, the package's default name: that
 * name is already taken here by the table this app counted into before, with
 * a different shape (`owner_id, period, accepted, rejected`). The old rows are
 * copied across by the same migration and the old table is left in place,
 * because it is what a billing dispute about a past month is settled with.
 */
export const USAGE_TABLE = 'hq_usage_counters'

/** The app is Postgres in production; SQLite is accepted so a local install still counts. */
export function usageDialect(): SqlDialect {
  const connection = String(process.env.DB_CONNECTION ?? '').toLowerCase()
  return connection === 'sqlite' ? 'sqlite' : connection === 'mysql' ? 'mysql' : 'postgres'
}

export const counter = createCounter({
  store: sqlCounterStore(db, { dialect: usageDialect(), table: USAGE_TABLE }),
})
