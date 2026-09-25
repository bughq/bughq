import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { dispatch } from '@stacksjs/events'
import { Auth, register } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { schema } from '@stacksjs/validation'
import { buildAuthCookie } from '../../Support/authCookie'

/**
 * Project override of the framework's default RegisterAction (registered by
 * string in routes/auth.ts, which loads before the framework defaults and
 * therefore wins on the duplicate method+path).
 *
 * Identical registration flow to the framework default, with one
 * addition: on success the issued bearer is also mirrored into an
 * HttpOnly `auth-token` cookie, exactly like LoginAction. Without this a
 * just-registered user has a token in the response body but no cookie, so
 * the server-rendered dashboard can't resolve them during SSR and the
 * post-signup redirect lands on a "you need to sign in" empty state. See
 * Support/authCookie.ts.
 *
 * bughq has no team model, so there is no personal-team bootstrap here
 * (projects are owned directly by `owner_id`).
 */
export default new Action({
  name: 'RegisterAction',
  description: 'Register a new user',
  method: 'POST',

  validations: {
    email: {
      rule: schema.string().email(),
      message: 'Email must be a valid email address.',
    },
    password: {
      rule: schema.string().min(6).max(255),
      message: 'Password must be between 6 and 255 characters.',
    },
    name: {
      rule: schema.string().min(2).max(255),
      message: 'Name must be between 2 and 255 characters.',
    },
  },

  async handle(request: RequestInstance) {
    const email = String(request.get('email') ?? '').trim().toLowerCase()
    const password = request.get('password')
    const name = request.get('name')

    const result = await register({ email, password, name })

    if (result) {
      const user = await Auth.getUserFromToken(result.token)

      // Fire `user:registered` so app/Events.ts listeners (welcome email)
      // actually run. Fire-and-forget — listener errors are caught by the
      // wildcard handler so a flaky welcome email doesn't fail registration.
      // The `to` alias matches the contract SendWelcomeEmail expects. Skip
      // the dispatch outright when there is no address to send to.
      if (user?.email) {
        dispatch('user:registered', {
          id: user.id,
          email: user.email,
          name: user.name,
          to: user.email,
        })
      }

      return response.json(
        {
          token: result.token,
          user: {
            id: user?.id,
            email: user?.email,
            name: user?.name,
          },
        },
        { status: 200, headers: { 'Set-Cookie': buildAuthCookie(result.token) } },
      )
    }

    return response.error('Registration failed')
  },
})
