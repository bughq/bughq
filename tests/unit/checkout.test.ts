import { afterAll, describe, expect, it, mock } from 'bun:test'

/**
 * Upgrading to Pro. Stacks 0.75 replaced the billable trait's Stripe-shaped
 * `user.checkout(items, options)` with the payment driver's
 * `user.checkout({ mode, lines, successUrl, cancelUrl, ... })`; a call in the
 * old form would now reach the driver with an array where it reads `mode`.
 */

// Only the price lookup reaches Stripe. Restored afterwards, since a module
// mock outlives the file that set it.
const realPayments = await import('@stacksjs/payments')
const looked: string[] = []
mock.module('@stacksjs/payments', () => ({
  ...realPayments,
  getPrice: async (lookupKey: string) => {
    looked.push(lookupKey)
    return { id: `price_${lookupKey}` }
  },
}))
afterAll(() => {
  mock.module('@stacksjs/payments', () => realPayments)
})

const { BILLABLE_INSTANCE_METHODS } = await import('@stacksjs/orm')
const { default: CreateCheckoutAction } = await import('../../app/Actions/Payment/CreateCheckoutAction')

/** A signed-in user carrying the billable methods, recording its checkouts. */
function billableUser(checkouts: unknown[]) {
  const user: Record<string, unknown> = { id: 7 }
  for (const name of BILLABLE_INSTANCE_METHODS)
    user[name] = async () => undefined
  user.checkout = async (request: unknown) => {
    checkouts.push(request)
    return { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', expiresAt: null, raw: {} }
  }
  return user
}

function request(user: unknown, interval?: string) {
  return { headers: new Headers(), bearerToken: () => '', user: async () => user, jsonBody: { interval } } as any
}

describe('CreateCheckoutAction', () => {
  it('checks out the Pro price in the payment driver\'s terms', async () => {
    const checkouts: any[] = []
    const res = await CreateCheckoutAction.handle(request(billableUser(checkouts), 'yearly')) as Response

    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/cs_1' })
    expect(looked.at(-1)).toBe('bughq_pro_yearly')
    expect(checkouts).toHaveLength(1)
    expect(checkouts[0]).toMatchObject({
      mode: 'subscription',
      lines: [{ price: 'price_bughq_pro_yearly', quantity: 1 }],
      allowPromotionCodes: true,
    })
    expect(checkouts[0].successUrl).toEndWith('/dashboard?upgraded=1')
    expect(checkouts[0].cancelUrl).toEndWith('/pricing')
  })

  it('answers that billing is unavailable for a user without the billing methods', async () => {
    const res = await CreateCheckoutAction.handle(request({ id: 7 })) as Response
    expect(res.status).toBe(503)
  })
})
