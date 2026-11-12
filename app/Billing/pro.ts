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

/** How long the last known plan is trusted after the lookup itself failed. */
const STALE_TTL_MS = 300_000

/**
 * How many accounts' last known plan is remembered. Far above the number of
 * accounts a process sees between deploys; it exists so the map has a bound.
 */
const MAX_REMEMBERED = 50_000

/**
 * Billing is off entirely when no Stripe secret is configured, which is the
 * normal state for a self-hosted install. With no way to subscribe, gating would
 * lock every user out of features they can never unlock, so everything is
 * unlimited instead.
 */
export function billingEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

export interface PlanResolverOptions {
  /** Whether this account has a live subscription. Throws when it cannot tell. */
  lookup: (userId: number) => Promise<boolean>
  enabled?: () => boolean
  now?: () => number
  onError?: (error: unknown) => void
}

export interface PlanResolver {
  isPro: (userId: number | null | undefined) => Promise<boolean>
  forget: (userId: number | null | undefined) => void
  /** Drop verdicts whose time is up. The last known plan is kept. */
  sweep: () => void
}

/**
 * Builds the "is this account Pro" question over a lookup.
 *
 * Two answers do not depend on the lookup at all, and neither is a failure:
 * an event with no owner has nobody to bill, and an install with billing off
 * has nothing to sell. Both are unlimited.
 *
 * **When the lookup fails, the last known plan answers. With none known, the
 * account is Free.** This used to answer Pro, which made a billing outage the
 * one moment every free account was unlimited, and made "break the lookup" a
 * way to get the paid plan. The last known plan is remembered for the life of
 * the process (it does not expire with the cache), so a customer who was seen
 * as Pro stays Pro through an outage of any length. Only an account this
 * process has never resolved falls back to Free, and Free still ingests: the
 * cost of being wrong is sampling past the allowance, never a refused request.
 */
export function createPlanResolver(options: PlanResolverOptions): PlanResolver {
  const enabled = options.enabled ?? billingEnabled
  const now = options.now ?? Date.now
  const onError = options.onError ?? ((error) => {
    console.error('[billing] isPro lookup failed:', error instanceof Error ? error.message : error)
  })

  /** Verdicts are cached briefly so a hot path never queries per request. */
  const cache = new Map<number, { pro: boolean, until: number }>()
  /** The last answer a lookup actually gave, kept past the cache's TTL. */
  const lastKnown = new Map<number, boolean>()

  function remember(id: number, pro: boolean): void {
    // Re-inserting moves the account to the end, so eviction drops whoever was
    // resolved longest ago.
    lastKnown.delete(id)
    lastKnown.set(id, pro)
    if (lastKnown.size > MAX_REMEMBERED) {
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
      remember(id, pro)
      cache.set(id, { pro, until: now() + (pro ? PRO_TTL_MS : FREE_TTL_MS) })
      return pro
    }
    catch (error) {
      onError(error)
      const known = lastKnown.get(id)
      if (known !== undefined) {
        // Hold the last known answer rather than inventing one, and stop asking
        // a database that is already struggling on every request.
        cache.set(id, { pro: known, until: now() + STALE_TTL_MS })
        return known
      }
      // Never resolved, so nothing says this account pays. Re-checked soon:
      // the lookup may be back in seconds.
      cache.set(id, { pro: false, until: now() + FREE_TTL_MS })
      return false
    }
  }

  function forget(userId: number | null | undefined): void {
    if (userId == null || !Number.isFinite(Number(userId)))
      return
    // Both, deliberately. This is called when Stripe says the plan changed, so
    // the remembered plan is exactly what is now wrong.
    cache.delete(Number(userId))
    lastKnown.delete(Number(userId))
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

const resolver = createPlanResolver({
  lookup: async (id) => {
    const row = (await db.unsafe(
      `SELECT 1 FROM subscriptions
        WHERE user_id = $1 AND type = 'default'
          AND provider_status IN ('active', 'trialing', 'past_due')
          AND (ends_at IS NULL OR ends_at > NOW())
        LIMIT 1`,
      [id],
    ))?.[0]
    return !!row
  },
})

/**
 * True when the account may use Pro features. See `createPlanResolver` for
 * what happens when the lookup fails.
 */
export function isPro(userId: number | null | undefined): Promise<boolean> {
  return resolver.isPro(userId)
}

/**
 * Drop what is known about an account. Called by the Stripe webhook so an
 * upgrade takes effect immediately rather than after the TTL: the moment
 * someone pays is exactly when they will go looking for what they bought.
 */
export function forgetPro(userId: number | null | undefined): void {
  resolver.forget(userId)
}

/**
 * `past_due` counts as Pro above. Stripe reports it while it retries a failed
 * payment, which can run for days; cutting service off on the first failed
 * charge would punish an expired card rather than a non-payment. The
 * subscription becomes `canceled` if the retries never succeed, and that does
 * not count.
 */

// Evict expired verdicts so a long-lived process does not accumulate one cache
// entry per user seen. unref() so this timer never holds the process open.
const sweeper = setInterval(() => resolver.sweep(), 60_000)
if (typeof sweeper === 'object' && sweeper && 'unref' in sweeper)
  (sweeper as { unref: () => void }).unref()
