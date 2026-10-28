import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, getTwoFactorState } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { isPro } from '../Billing/pro'
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
    // /api/me has no `.middleware('auth')`, so resolve the session here: a
    // bearer (external API-token callers) OR the HttpOnly `auth-token` cookie
    // the dashboard/account client sends (credentials:'same-origin', no
    // Authorization header). request.user() is the last resort.
    const authHeader = ((request as any).headers?.get?.('authorization') ?? '')
    let token = (request as any).bearerToken?.() ?? authHeader.replace(/^Bearer\s+/i, '')
    if (!token) {
      const cookie = ((request as any).headers?.get?.('cookie') ?? '')
      const m = cookie.match(/(?:^|;)\s*auth-token=([^;]+)/)
      if (m)
        token = decodeURIComponent(m[1])
    }
    const user = token ? await Auth.getUserFromToken(token) : await request.user()
    if (!user)
      return response.unauthorized('Authentication required')

    // isPro(), not Payment.hasActiveSubscription(): that helper reads
    // subscriptions with no ORDER BY against a table with no unique on
    // (user_id, type), so a stale canceled row can shadow a live subscription
    // and downgrade a paying customer. See app/Billing/pro.ts.
    //
    // It also fails OPEN, where this used to `catch { pro = false }` — a
    // momentary database error rendered a paying customer as Free and hid the
    // features they had paid for.
    const pro = await isPro(Number((user as any).id))

    // Only `enabled` reaches the client. getTwoFactorState also returns the
    // TOTP secret, which must never leave the server - the account page needs
    // to know whether to show "set up" or "turn off", nothing more. Fails
    // closed (shows "off") on a read error rather than hiding an enabled
    // factor, which is the safer wrong answer here: it offers re-setup, it
    // never implies protection that is not there.
    const twoFactor = await getTwoFactorState(Number((user as any).id)).catch(() => ({ enabled: false }))

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
        two_factor_enabled: Boolean(twoFactor.enabled),
      },
      pro,
      plan: pro ? 'pro' : 'free',
    })
  },
})
