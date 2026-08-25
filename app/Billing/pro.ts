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

/** Verdicts are cached briefly so a hot path never queries per request. */
const cache = new Map<number, { pro: boolean, until: number }>()

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
 * Billing is off entirely when no Stripe secret is configured — which is the
 * normal state for a self-hosted install. With no way to subscribe, gating would
 * lock every user out of features they can never unlock, so everything is
 * unlimited instead.
 */
export function billingEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/**
 * True when the account may use Pro features.
 *
 * **Fails open, deliberately.** Every failure mode here — a null owner, an
 * unreachable database, billing not configured — resolves to `true`. The
 * asymmetry is the point: wrongly granting Pro for a few minutes costs a little
 * revenue, while wrongly denying it takes a paying customer's product away
 * during an incident they did not cause. A billing lookup must never be able to
 * turn a database blip into an outage.
 */
export async function isPro(userId: number | null | undefined): Promise<boolean> {
  // Unattributable — a project with no owner. Nothing to bill, nothing to gate.
  if (userId == null || !Number.isFinite(Number(userId)))
    return true
  if (!billingEnabled())
    return true

  const id = Number(userId)
  const hit = cache.get(id)
  if (hit && Date.now() < hit.until)
    return hit.pro

  try {
    const row = (await db.unsafe(
      `SELECT 1 FROM subscriptions
        WHERE user_id = $1 AND type = 'default'
          AND provider_status IN ('active', 'trialing', 'past_due')
          AND (ends_at IS NULL OR ends_at > NOW())
        LIMIT 1`,
      [id],
    ))?.[0]
    const pro = !!row
    cache.set(id, { pro, until: Date.now() + (pro ? PRO_TTL_MS : FREE_TTL_MS) })
    return pro
  }
  catch (err) {
    console.error('[billing] isPro lookup failed:', err instanceof Error ? err.message : err)
    // Hold the last known answer rather than inventing one. A customer who was
    // Pro a minute ago is still Pro; only the lookup is broken.
    if (hit) {
      cache.set(id, { pro: hit.pro, until: Date.now() + STALE_TTL_MS })
      return hit.pro
    }
    return true
  }
}

/**
 * Drop a cached verdict. Called by the Stripe webhook so an upgrade takes effect
 * immediately rather than after the TTL — the moment someone pays is exactly
 * when they will go looking for what they bought.
 */
export function forgetPro(userId: number | null | undefined): void {
  if (userId != null && Number.isFinite(Number(userId)))
    cache.delete(Number(userId))
}

/**
 * `past_due` counts as Pro above. Stripe reports it while it retries a failed
 * payment, which can run for days; cutting service off on the first failed
 * charge would punish an expired card rather than a non-payment. The
 * subscription becomes `canceled` if the retries never succeed, and that does
 * not count.
 */

// Evict expired entries so a long-lived process does not accumulate one entry
// per user seen. Same shape as the sweeper in app/Errors/limits.ts. unref() so
// this timer never holds the process open on shutdown.
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of cache) {
    if (now >= entry.until)
      cache.delete(id)
  }
}, 60_000)
if (typeof sweeper === 'object' && sweeper && 'unref' in sweeper)
  (sweeper as { unref: () => void }).unref()
