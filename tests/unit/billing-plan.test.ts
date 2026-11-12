import { describe, expect, test } from 'bun:test'
import { createPlanResolver } from '../../app/Billing/pro'

/** A resolver over a lookup the test can break and a clock it can move. */
function harness(plans: Record<number, boolean> = {}) {
  const state = { down: false, calls: 0, at: 1_000_000, errors: 0, enabled: true }
  const resolver = createPlanResolver({
    enabled: () => state.enabled,
    now: () => state.at,
    onError: () => { state.errors += 1 },
    lookup: async (id) => {
      state.calls += 1
      if (state.down)
        throw new Error('connection refused')
      return plans[id] === true
    },
  })
  return { resolver, state, plans }
}

const MINUTE = 60_000

describe('isPro when the billing lookup works', () => {
  test('answers the subscription state and caches it', async () => {
    const { resolver, state } = harness({ 1: true, 2: false })
    expect(await resolver.isPro(1)).toBe(true)
    expect(await resolver.isPro(2)).toBe(false)
    expect(await resolver.isPro(1)).toBe(true)
    expect(state.calls).toBe(2)
  })

  test('re-checks a Free verdict sooner than a Pro one', async () => {
    const { resolver, state, plans } = harness({ 1: false })
    expect(await resolver.isPro(1)).toBe(false)
    plans[1] = true // they just paid
    state.at += 11_000
    expect(await resolver.isPro(1)).toBe(true)
  })

  test('an event with no owner and an install with billing off are not gated', async () => {
    const { resolver, state } = harness()
    expect(await resolver.isPro(null)).toBe(true)
    expect(await resolver.isPro(undefined)).toBe(true)
    state.enabled = false
    expect(await resolver.isPro(5)).toBe(true)
    expect(state.calls).toBe(0)
  })
})

describe('isPro when the billing lookup fails', () => {
  test('an account never resolved is treated as Free, not Pro', async () => {
    const { resolver, state } = harness({ 1: true })
    state.down = true
    expect(await resolver.isPro(1)).toBe(false)
    expect(state.errors).toBe(1)
  })

  test('a known Pro account stays Pro for as long as the outage lasts', async () => {
    const { resolver, state } = harness({ 1: true })
    expect(await resolver.isPro(1)).toBe(true)
    state.down = true
    // Well past both the cache TTL and the stale TTL, repeatedly.
    for (let i = 0; i < 5; i++) {
      state.at += 30 * MINUTE
      resolver.sweep()
      expect(await resolver.isPro(1)).toBe(true)
    }
  })

  test('a known Free account stays Free', async () => {
    const { resolver, state } = harness({ 1: false })
    expect(await resolver.isPro(1)).toBe(false)
    state.down = true
    state.at += 30 * MINUTE
    expect(await resolver.isPro(1)).toBe(false)
  })

  test('the last known plan is held without asking a failing database on every call', async () => {
    const { resolver, state } = harness({ 1: true })
    await resolver.isPro(1)
    state.down = true
    state.at += 2 * MINUTE
    await resolver.isPro(1)
    const callsAfterFirstFailure = state.calls
    await resolver.isPro(1)
    await resolver.isPro(1)
    expect(state.calls).toBe(callsAfterFirstFailure)
  })

  test('the Free fallback is re-checked within seconds, so recovery is quick', async () => {
    const { resolver, state } = harness({ 1: true })
    state.down = true
    expect(await resolver.isPro(1)).toBe(false)
    state.down = false
    state.at += 11_000
    expect(await resolver.isPro(1)).toBe(true)
  })

  test('recovering replaces the held answer with the real one', async () => {
    const { resolver, state, plans } = harness({ 1: true })
    await resolver.isPro(1)
    state.down = true
    state.at += 2 * MINUTE
    expect(await resolver.isPro(1)).toBe(true)
    state.down = false
    plans[1] = false // cancelled during the outage
    state.at += 6 * MINUTE
    expect(await resolver.isPro(1)).toBe(false)
  })

  test('forgetting an account drops its last known plan too', async () => {
    const { resolver, state } = harness({ 1: true })
    await resolver.isPro(1)
    resolver.forget(1) // the Stripe webhook said the plan changed
    state.down = true
    expect(await resolver.isPro(1)).toBe(false)
  })
})
