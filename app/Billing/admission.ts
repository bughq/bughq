import type { Admission, UsageCounter } from '@stacksjs/hq/meter'
import { formatUsageHeader, USAGE_HEADER } from '@stacksjs/hq/meter'
import { ERRORS_METER, errorsLimitFor } from './limits'

/**
 * Whether one incoming error is stored, and the header that says where the
 * account stands.
 *
 * The decision itself is `@stacksjs/hq/meter`'s soft-ingest policy against the
 * allowance in ./limits.ts:
 *
 *   - up to the allowance: kept
 *   - from the allowance to 120% of it: still kept (the grace)
 *   - past 120%: one event in ten is kept
 *
 * A paid account, a project with no owner, and an install with billing
 * switched off all have no limit: they are counted and never dropped.
 *
 * ## Why a dropped event is still a 2xx
 *
 * An SDK treats a non-2xx as a failed delivery and retries it, so refusing an
 * event over quota would be answered with the same event again: more load for
 * the same data, and a queue on the device that never drains. The response is
 * therefore always a success, and `X-HQ-Usage` on it is how a client or a
 * person learns the account is over.
 *
 * Dependencies are passed in so this is decided the same way in a test as on
 * the request path: a counter over a memory store, and a plan check that does
 * not need a database.
 */

export interface AdmissionDeps {
  counter: Pick<UsageCounter, 'admit'>
  isPro: (ownerId: number | null | undefined) => Promise<boolean>
  /** Where this service sells its plan. Absolute. */
  upgradeUrl: () => string
}

export interface ErrorAdmission {
  /** Store the event. `false` means sampled out: answer 2xx and write nothing. */
  accept: boolean
  admission: Admission
  /** `{ 'X-HQ-Usage': 'errors;412;500;warn;upgrade=...' }`, to spread into the response headers. */
  headers: Record<string, string>
}

export async function admitError(ownerId: number | null | undefined, deps: AdmissionDeps): Promise<ErrorAdmission> {
  const owner = ownerId == null || !Number.isFinite(Number(ownerId)) ? null : Number(ownerId)
  // isPro is cached per account (ten seconds for Free, a minute for Pro), so
  // this is a Map lookup on all but the first event in each window.
  const limit = owner === null ? null : errorsLimitFor(await deps.isPro(owner) ? 'pro' : 'free')
  const admission = deps.counter.admit(owner, ERRORS_METER, limit)
  return {
    accept: admission.accept,
    admission,
    headers: {
      [USAGE_HEADER]: formatUsageHeader({
        meter: admission.meter,
        used: admission.used,
        limit: admission.limit,
        state: admission.state,
        upgradeUrl: deps.upgradeUrl(),
      }),
    },
  }
}
