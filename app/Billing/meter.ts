import type { Admission, UsageCounter } from '@stacksjs/hq/meter'
import { db } from '@stacksjs/database'
import { createCounter, formatUsageHeader, sqlCounterStore, USAGE_HEADER } from '@stacksjs/hq/meter'
import { appUrl } from '../Support/urls'
import { ERRORS_METER, errorsPerMonth } from './plans'

/**
 * Per-account monthly error metering, and the decision the ingest makes with it.
 *
 * The counting is `@stacksjs/hq/meter`'s: `admit` touches Maps and returns, and
 * a timer folds the buffered deltas into the table every ten seconds with an
 * additive upsert. Nothing here adds a database round-trip to `POST /errors`,
 * which is the constraint the previous app/Billing/usage.ts was built around
 * and the package generalizes. A crash loses at most one interval of counts.
 *
 * What this file owns is the BugHQ side: which table, which meter, which
 * allowance (app/Billing/plans.ts) and what the response says about it.
 */

/**
 * Not `usage_counters`. That name is taken by the table 0000000039 created
 * with a different shape (owner_id, period, accepted, rejected); it is kept
 * as the record of what was counted before enforcement and is no longer
 * written. 0000000047 creates this one and carries the old totals over.
 */
export const USAGE_TABLE = 'hq_usage_counters'

/** Where this service sells its plan. Absolute, because it travels in a header. */
export function upgradeUrl(): string {
  return `${appUrl()}/pricing`
}

export const usageCounter: UsageCounter = createCounter({
  store: sqlCounterStore(db, { dialect: 'postgres', table: USAGE_TABLE }),
})

export interface ErrorAdmission {
  /** Whether to store the event. The response is 2xx either way. */
  accept: boolean
  admission: Admission
  /** `X-HQ-Usage`, to merge into the response. */
  headers: Record<string, string>
}

/**
 * Decide one error against the owning account's allowance, and count it.
 *
 * Free accounts are taken in full to 120% of the allowance, then one in ten.
 * A Pro account is unlimited and still counted. An event with no owner is not
 * metered and never dropped.
 *
 * The caller answers 2xx whatever this says. A refusal would only make the
 * SDK retry, which is more load for the same data, so the account is told
 * through the header instead.
 */
export function admitError(
  counter: UsageCounter,
  ownerId: number | string | null | undefined,
  pro: boolean,
  upgrade: string = upgradeUrl(),
): ErrorAdmission {
  const admission = counter.admit(ownerId, ERRORS_METER, errorsPerMonth(pro))
  return {
    accept: admission.accept,
    admission,
    headers: {
      [USAGE_HEADER]: formatUsageHeader({
        meter: admission.meter,
        used: admission.used,
        limit: admission.limit,
        state: admission.state,
        upgradeUrl: upgrade,
      }),
    },
  }
}
