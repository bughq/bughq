/**
 * What each plan allows. One place, so the pricing page, the gates and the
 * usage meter cannot drift apart.
 *
 * resources/views/pricing.stx renders these values rather than restating them,
 * and the ingest (app/Billing/meter.ts) enforces the same constants. Change a
 * number here and both the copy and the enforcement move with it.
 */

/** The meter errors are counted under in `hq_usage_counters` and `X-HQ-Usage`. */
export const ERRORS_METER = 'errors'

/** Free's monthly error allowance, per ACCOUNT (not per project). */
export const FREE_ERRORS_PER_MONTH = 500

/**
 * A plan's monthly error allowance. `null` is unlimited.
 *
 * What happens past it is not decided here: the ingest takes everything up to
 * 120% of the allowance and then keeps one error in ten (`SOFT_INGEST` in
 * `@stacksjs/hq/meter`), and it never refuses a request over quota.
 */
export function errorsPerMonth(pro: boolean): number | null {
  return pro ? null : FREE_ERRORS_PER_MONTH
}

/** "500", "5,000": the allowance as the pricing page prints it. */
export function formatAllowance(value: number): string {
  return value.toLocaleString('en-US')
}

/** Free's advertised project allowance. */
export const FREE_PROJECTS = 5

/**
 * Free's teammate allowance. Zero: teams are a Pro feature.
 *
 * This does NOT retroactively remove anyone: see the note below.
 */
export const FREE_MEMBERS = 0

/**
 * Nothing you already have is ever taken away.
 *
 * The caps above are checked when you CREATE a project or send an invite, not
 * when you use one. An account with three projects keeps all three and simply
 * cannot make a fourth; a project with two members keeps both and cannot add a
 * third. That falls out of gating creation rather than access, so there is no
 * grandfathering flag to store, drift, or explain.
 */
