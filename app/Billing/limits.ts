import { graceCeiling, SOFT_INGEST } from '@stacksjs/hq/meter'

/**
 * What each plan allows. The ONE place, so the pricing page, the gates and the
 * ingest meter cannot drift apart.
 *
 * Everything that enforces a number imports it from here
 * (app/Billing/admission.ts, routes/projects.ts, app/Hq/adapter.ts), and so
 * does everything that advertises one (resources/views/pricing.stx renders
 * `freeErrorsLabel()` rather than a literal). Changing a number here changes
 * both at once; there is no second copy to forget.
 */

/** The meter ingest counts against. Also the name in `X-HQ-Usage` and `GET /api/v1/usage`. */
export const ERRORS_METER = 'errors'

/**
 * Free's monthly error allowance, per ACCOUNT (not per project), per calendar
 * month in UTC.
 *
 * Over it, ingest never refuses: everything is kept up to 120% of this number,
 * and past that one event in ten is kept. That shape is `SOFT_INGEST` from
 * `@stacksjs/hq/meter`, the same policy every HQ service applies, so it is not
 * restated here as numbers that could disagree with the package.
 */
export const FREE_ERRORS_PER_MONTH = 500

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
 * The project and member caps are checked when you CREATE a project or send an
 * invite, not when you use one. An account with three projects keeps all three
 * and simply cannot make a fourth; a project with two members keeps both and
 * cannot add a third. That falls out of gating creation rather than access, so
 * there is no grandfathering flag to store, drift, or explain.
 */

/**
 * The monthly error allowance for an account.
 *
 * `null` is unlimited, which is what a paid account has. Kept as a function so
 * a second paid tier with its own number has one place to land.
 */
export function errorsLimitFor(plan: 'free' | 'pro'): number | null {
  return plan === 'pro' ? null : FREE_ERRORS_PER_MONTH
}

/** `500`, `5,000`: the allowance the way copy writes it. */
export function formatAllowance(count: number): string {
  return count.toLocaleString('en-US')
}

/** The line the pricing page shows for Free. */
export function freeErrorsLabel(): string {
  return `${formatAllowance(FREE_ERRORS_PER_MONTH)} errors a month`
}

/**
 * What happens past the allowance, in the numbers the meter actually uses.
 *
 * Derived from the policy rather than written out, so if the grace or the
 * sampling rate ever changes in `@stacksjs/hq/meter` this sentence changes
 * with it instead of describing the old behaviour.
 */
export function freeOverageLabel(): string {
  const ceiling = graceCeiling(FREE_ERRORS_PER_MONTH, SOFT_INGEST) ?? FREE_ERRORS_PER_MONTH
  return `Go over on Free and nothing breaks. We keep every error up to ${formatAllowance(ceiling)} that month, then one in ${SOFT_INGEST.keepEvery}, until you upgrade or the month turns.`
}
