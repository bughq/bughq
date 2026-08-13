import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { Payment } from '@stacksjs/payments'
import { response } from '@stacksjs/router'

/**
 * Return the authenticated user plus their Pro status. The dashboard calls this
 * to gate Pro features and reflect the plan after a successful checkout. Pro is
 * true when a local `subscriptions` row for this user (type 'default') is
 * active/trialing — kept in sync by the Stripe webhook.
 */
export default new Action({
  name: 'MeAction',
  description: 'Return the current user and their Pro status',
  method: 'GET',
  async handle(request: RequestInstance) {
    const authHeader = ((request as any).headers?.get?.('authorization') ?? '')
    const bearer = (request as any).bearerToken?.() ?? authHeader.replace(/^Bearer\s+/i, '')
    const user = bearer ? await Auth.getUserFromToken(bearer) : await request.user()
    if (!user)
      return response.unauthorized('Authentication required')

    let pro = false
    try {
      pro = await Payment.hasActiveSubscription(user as any, 'default')
    }
    catch {
      pro = false
    }

    // Two selects, not one, and the split is the whole point.
    //
    // `avatar` and `provider` do not exist on the users table in this schema.
    // A select naming a missing column fails as a statement, so the catch below
    // threw away `created_at` too — a NOT NULL column that is always present and
    // was being read in the same breath. The account page rendered "Member
    // since --" for every user who ever loaded it: not a date-formatting bug,
    // a column that never actually reached the client.
    //
    // The original comment said "tolerate columns not existing yet", which was
    // the right intent implemented as all-or-nothing. Tolerance has to be per
    // column, so the guaranteed field gets its own statement.
    let createdAt: unknown = null
    try {
      const row = await db.selectFrom('users')
        .where('id', '=', (user as any).id)
        .select(['created_at'])
        .executeTakeFirst()
      createdAt = (row as any)?.created_at ?? null
    }
    catch {
      createdAt = null
    }

    // Still optional, still tolerated — these genuinely may not be there.
    let profile: any = {}
    try {
      profile = await db.selectFrom('users')
        .where('id', '=', (user as any).id)
        .select(['avatar', 'provider'])
        .executeTakeFirst() ?? {}
    }
    catch {
      profile = {}
    }

    return response.json({
      user: {
        id: (user as any).id,
        name: (user as any).name,
        email: (user as any).email,
        avatar: profile.avatar ?? (user as any).avatar ?? null,
        provider: profile.provider ?? null,
        created_at: createdAt ?? null,
      },
      pro,
      plan: pro ? 'pro' : 'free',
    })
  },
})
