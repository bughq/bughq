import { db } from '@stacksjs/database'

/**
 * The single definition of "is this account Pro".
 *
 * This exists rather than calling `Payment.hasActiveSubscription(user, 'default')`
 * because that helper has two properties this app cannot live with:
 *
 * 1. **It can downgrade a paying customer on a healthy system.** `isValid` runs
 *    `selectFrom('subscriptions').where(user_id).where(type).executeTakeFirst()`
 *    with NO `ORDER BY`, and there is no unique on `(user_id, type)` — the table
 *    carries uniques on `provider_id` and `uuid` only. `StripeWebhook` dedupes on
 *    `provider_id`, so cancelling and resubscribing inserts a SECOND row for the
 *    same user. From then on an arbitrary row wins, and a stale
 *    `provider_status = 'canceled'` can shadow a live subscription.
 * 2. **It takes a user object**, which the ingest path never has — it resolves a
 *    project, not a user. Entitlement has to be answerable from an id alone.
 *
 * The query below is explicit about which statuses count and honours `ends_at`,
 * so cancelling mid-period does not cut off service that has been paid for.
 */

/**
 * A Pro verdict is held longer than a Free one on purpose: the expensive mistake
 * is telling someone who has just paid that they are still on Free, so a Free
 * verdict is re-checked within ten seconds of them completing checkout.
 */
const PRO_TTL_MS = 60_000
const FREE_TTL_MS = 10_000

/** How long a verdict is trusted after the lookup itself failed. */
const STALE_TTL_MS = 300_000

/**
 * How many accounts' last known plan are remembered. Past this the oldest is
 * forgotten, so a long-lived process cannot grow one entry per account ever
 * seen. An account forgotten here is only affected if its lookup then fails.
 */
const LAST_KNOWN_MAX = 50_000

/**
 * Billing is off entirely when no Stripe secret is configured, which is the
 * normal state for a self-hosted install. With no way to subscribe, gating would
 * lock every user out of features they can never unlock, so everything is
 * unlimited instead.
 */
export function billingEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

export interface EntitlementOptions {
  /** Whether this account has a subscription that counts. Throws when it cannot tell. */
  lookup: (userId: number) => Promise<boolean>
  enabled?: () => boolean
  now?: () => number
  onError?: (error: unknown) => void
}

export interface Entitlements {
  isPro: (userId: number | null | undefined) => Promise<boolean>
  forget: (userId: number | null | undefined) => void
  /** Drop cache entries whose time is up. The last known plans are kept. */
  sweep: () => void
}

/**
 * The plan check, with its lookup passed in so the failure path can be tested
 * without a database.
 *
 * ## When the lookup fails: last known plan, then Free
 *
 * This used to fail open: any error answered "Pro". That was defensible while
 * nothing was enforced, and it stops being so the moment the answer decides
 * how many errors an account may store, because then a database blip, or
 * anything that makes the query throw for one account, is an unmetered plan.
 *
 * So a failed lookup answers with the last plan this process actually read for
 * that account, for as long as the lookup keeps failing. A customer who was
 * Pro a minute ago is still Pro; only the lookup is broken. Only an account
 * with NO known plan is treated as Free, and Free is not an outage: ingest
 * still answers 2xx and still stores events up to the Free allowance and its
 * grace (app/Billing/admission.ts).
 *
 * The last known plan is kept apart from the short-lived cache on purpose. The
 * cache forgets an entry when its TTL runs out, which is exactly when a
 * failing lookup would need it.
 */
export function createEntitlements(options: EntitlementOptions): Entitlements {
  const enabled = options.enabled ?? billingEnabled
  const now = options.now ?? (() => Date.now())
  const onError = options.onError ?? ((error) => {
    console.error('[billing] isPro lookup failed:', error instanceof Error ? error.message : error)
  })

  /** Verdicts are cached briefly so a hot path never queries per request. */
  const cache = new Map<number, { pro: boolean, until: number }>()
  /** The last plan a SUCCESSFUL lookup read, per account. Never expires by time. */
  const lastKnown = new Map<number, boolean>()

  function remember(id: number, pro: boolean): void {
    // Re-insert so iteration order is "least recently confirmed first".
    lastKnown.delete(id)
    lastKnown.set(id, pro)
    if (lastKnown.size > LAST_KNOWN_MAX) {
      const oldest = lastKnown.keys().next().value
      if (oldest !== undefined)
        lastKnown.delete(oldest)
    }
  }

  async function isPro(userId: number | null | undefined): Promise<boolean> {
    // Unattributable: a project with no owner. Nothing to bill, nothing to gate.
    if (userId == null || !Number.isFinite(Number(userId)))
      return true
    if (!enabled())
      return true

    const id = Number(userId)
    const hit = cache.get(id)
    if (hit && now() < hit.until)
      return hit.pro

    try {
      const pro = await options.lookup(id)
      cache.set(id, { pro, until: now() + (pro ? PRO_TTL_MS : FREE_TTL_MS) })
      remember(id, pro)
      return pro
    }
    catch (error) {
      onError(error)
      const known = lastKnown.get(id)
      if (known !== undefined) {
        // Held for a while so a database that is down is not asked again on
        // every request by every account.
        cache.set(id, { pro: known, until: now() + STALE_TTL_MS })
        return known
      }
      // Nothing known: Free, and asked again soon, so a paying account that
      // this process has simply never seen is corrected as soon as the lookup
      // works.
      cache.set(id, { pro: false, until: now() + FREE_TTL_MS })
      return false
    }
  }

  function forget(userId: number | null | undefined): void {
    if (userId != null && Number.isFinite(Number(userId)))
      cache.delete(Number(userId))
  }

  function sweep(): void {
    const at = now()
    for (const [id, entry] of cache) {
      if (at >= entry.until)
        cache.delete(id)
    }
  }

  return { isPro, forget, sweep }
}

/**
 * `past_due` counts as Pro. Stripe reports it while it retries a failed
 * payment, which can run for days; cutting service off on the first failed
 * charge would punish an expired card rather than a non-payment. The
 * subscription becomes `canceled` if the retries never succeed, and that does
 * not count.
 */
async function subscriptionLookup(id: number): Promise<boolean> {
  const row = (await db.unsafe(
    `SELECT 1 FROM subscriptions
      WHERE user_id = $1 AND type = 'default'
        AND provider_status IN ('active', 'trialing', 'past_due')
        AND (ends_at IS NULL OR ends_at > NOW())
      LIMIT 1`,
    [id],
  ))?.[0]
  return !!row
}

const entitlements = createEntitlements({ lookup: subscriptionLookup })

/**
 * True when the account may use Pro features.
 *
 * A null owner and an install with billing switched off both answer `true`:
 * neither is a failure, there is simply nothing to gate. A lookup that FAILS
 * answers the last known plan and otherwise Free; see `createEntitlements`.
 */
export function isPro(userId: number | null | undefined): Promise<boolean> {
  return entitlements.isPro(userId)
}

/**
 * Drop a cached verdict. Called by the Stripe webhook so an upgrade takes effect
 * immediately rather than after the TTL: the moment someone pays is exactly
 * when they will go looking for what they bought.
 */
export function forgetPro(userId: number | null | undefined): void {
  entitlements.forget(userId)
}

// Evict expired entries so a long-lived process does not accumulate one entry
// per user seen. Same shape as the sweeper in app/Errors/limits.ts. unref() so
// this timer never holds the process open on shutdown.
const sweeper = setInterval(() => entitlements.sweep(), 60_000)
if (typeof sweeper === 'object' && sweeper && 'unref' in sweeper)
  (sweeper as { unref: () => void }).unref()
