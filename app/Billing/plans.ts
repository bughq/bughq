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

/**
 * The fraction of the allowance at which a customer is warned. Warning only
 * when the cap is reached is too late — by then events are already being lost,
 * and a dropped event is invisible by definition.
 */
export const WARN_AT = 0.8
