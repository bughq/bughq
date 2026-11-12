import { describe, expect, test } from 'bun:test'
import { createEntitlements } from '../../app/Billing/pro'

/**
 * The plan check when the billing lookup fails: last known plan, then Free.
 * It used to answer Pro for any failure, which is an unmetered plan for as
 * long as the lookup stays broken.
 */
function harness(plans: Record<number, boolean>) {
  const state = { at: 1_000_000, failing: false, lookups: 0 }
  const errors: unknown[] = []
  const entitlements = createEntitlements({
    enabled: () => true,
    now: () => state.at,
    onError: error => errors.push(error),
    lookup: async (id) => {
      state.lookups++
      if (state.failing)
        throw new Error('connection refused')
      return plans[id] === true
    },
  })
  return { entitlements, state, errors }
}

describe('isPro when the billing lookup fails', () => {
  test('a healthy lookup answers the plan it read', async () => {
    const { entitlements } = harness({ 1: true, 2: false })
    expect(await entitlements.isPro(1)).toBe(true)
    expect(await entitlements.isPro(2)).toBe(false)
  })

  test('an account last seen on Pro stays Pro while the lookup is down', async () => {
    const { entitlements, state, errors } = harness({ 1: true })
    expect(await entitlements.isPro(1)).toBe(true)

    state.failing = true
    state.at += 61_000 // past the Pro cache
    expect(await entitlements.isPro(1)).toBe(true)
    expect(errors).toHaveLength(1)
  })

  test('the last known plan outlives the cache sweep', async () => {
    // The cache forgets an entry when its TTL runs out, which is exactly when
    // a failing lookup needs it. The last known plan is kept apart for that.
    const { entitlements, state } = harness({ 1: true })
    await entitlements.isPro(1)
    state.at += 3_600_000
    entitlements.sweep()
    state.failing = true
    expect(await entitlements.isPro(1)).toBe(true)
  })

  test('an account last seen on Free stays Free while the lookup is down', async () => {
    const { entitlements, state } = harness({ 2: false })
    expect(await entitlements.isPro(2)).toBe(false)
    state.failing = true
    state.at += 11_000
    expect(await entitlements.isPro(2)).toBe(false)
  })

  test('an account with no known plan is treated as Free, not Pro', async () => {
    const { entitlements, state } = harness({ 3: true })
    state.failing = true
    expect(await entitlements.isPro(3)).toBe(false)
  })

  test('an unknown account is asked again soon, and corrected once the lookup works', async () => {
    const { entitlements, state } = harness({ 3: true })
    state.failing = true
    expect(await entitlements.isPro(3)).toBe(false)

    state.failing = false
    state.at += 5_000 // still inside the short Free cache
    expect(await entitlements.isPro(3)).toBe(false)
    state.at += 6_000
    expect(await entitlements.isPro(3)).toBe(true)
  })

  test('a failing lookup is not retried on every request', async () => {
    const { entitlements, state } = harness({ 1: true })
    await entitlements.isPro(1)
    state.failing = true
    state.at += 61_000
    const before = state.lookups
    for (let i = 0; i < 50; i++)
      await entitlements.isPro(1)
    expect(state.lookups - before).toBe(1)
  })

  test('a downgrade seen before the outage is what the outage holds', async () => {
    const plans: Record<number, boolean> = { 1: true }
    const { entitlements, state } = harness(plans)
    expect(await entitlements.isPro(1)).toBe(true)
    plans[1] = false
    entitlements.forget(1)
    expect(await entitlements.isPro(1)).toBe(false)
    state.failing = true
    state.at += 11_000
    expect(await entitlements.isPro(1)).toBe(false)
  })

  test('nothing to gate is not a failure: no owner, or billing switched off', async () => {
    const { entitlements, state } = harness({})
    state.failing = true
    expect(await entitlements.isPro(null)).toBe(true)
    expect(await entitlements.isPro(undefined)).toBe(true)

    const off = createEntitlements({ enabled: () => false, lookup: async () => { throw new Error('never asked') } })
    expect(await off.isPro(7)).toBe(true)
  })
})
