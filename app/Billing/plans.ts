/**
 * What each plan allows. One place, so the pricing page, the gates and the
 * usage meter cannot drift apart.
 *
 * These numbers are what resources/views/pricing.stx advertises. Changing one
 * here without changing the page there makes the product lie, which is the
 * failure mode this file exists to prevent.
 */

/** Free's advertised monthly event allowance, per ACCOUNT (not per project). */
export const FREE_EVENTS_PER_MONTH = 5000

/** Free's advertised project allowance. */
export const FREE_PROJECTS = 1

/**
 * Free's teammate allowance. Zero: teams are a Pro feature.
 *
 * This does NOT retroactively remove anyone. Memberships that already exist
 * keep working — the gate is on creating new ones, and it is computed from
 * created_at rather than a stored grandfathering flag, which would drift and
 * outlive everyone who agreed to it.
 */
export const FREE_MEMBERS = 0

/**
 * When creation gates begin refusing. Before this instant every gate measures
 * and permits; after it, the caps above are enforced for resources created
 * from this date onward.
 *
 * Set once. Moving it later would re-gate accounts that had already adapted,
 * and moving it earlier would refuse things people were told were fine.
 */
export const ENFORCED_FROM = '2026-10-01T00:00:00.000Z'

/** True when creation gates should refuse rather than merely record. */
export function enforcing(now: Date = new Date()): boolean {
  return now.toISOString() >= ENFORCED_FROM
}

/**
 * The fraction of the allowance at which a customer is warned. Warning only
 * when the cap is reached is too late — by then events are already being lost,
 * and a dropped event is invisible by definition.
 */
export const WARN_AT = 0.8
