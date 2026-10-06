import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth } from '@stacksjs/auth'
import { config } from '@stacksjs/config'
import { isBillable } from '@stacksjs/orm'
import { getPrice } from '@stacksjs/payments'
import { response } from '@stacksjs/router'

/**
 * Start a Stripe Checkout session for the Pro plan (subscription mode) and
 * return its hosted URL. The client redirects the browser there. The price is
 * resolved from its Stripe `lookup_key` (see config/saas.ts), so no price id is
 * hard-coded. Requires an authenticated user.
 */
export default new Action({
  name: 'CreateCheckoutAction',
  description: 'Create a Stripe Checkout session for the Pro plan',
  method: 'POST',
  async handle(request: RequestInstance) {
    // Resolve the user from the bearer token directly, so this works whether or
    // not the 'auth' middleware alias populated request.user() on the route.
    const authHeader = ((request as any).headers?.get?.('authorization') ?? '')
    const bearer = (request as any).bearerToken?.() ?? authHeader.replace(/^Bearer\s+/i, '')
    const user = bearer ? await Auth.getUserFromToken(bearer) : await request.user()
    if (!user)
      return response.unauthorized('Authentication required')
    // The token resolves the framework's User, whose type has no billing
    // methods; this checks the record really has them, and narrows to them.
    if (!isBillable(user))
      return response.json({ error: 'Billing is not available yet. Please try again soon.' }, 503)

    const body = (request as any).jsonBody ?? {}
    const interval = body.interval === 'yearly' ? 'yearly' : 'monthly'
    const lookupKey = interval === 'yearly' ? 'bughq_pro_yearly' : 'bughq_pro_monthly'

    try {
      const price = await getPrice(lookupKey)
      if (!price)
        return response.json({ error: 'Billing is not configured yet.' }, 400)

      const checkout = await user.checkout({
        mode: 'subscription',
        lines: [{ price: price.id, quantity: 1 }],
        allowPromotionCodes: true,
        successUrl: `${config.app.url}/dashboard?upgraded=1`,
        cancelUrl: `${config.app.url}/pricing`,
      })

      return response.json({ url: checkout.url })
    }
    catch {
      return response.json({ error: 'Billing is not available yet. Please try again soon.' }, 503)
    }
  },
})
