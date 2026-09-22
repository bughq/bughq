import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, consumeTwoFactorChallenge, verifyTwoFactorLoginCode } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { schema } from '@stacksjs/validation'
import { buildAuthCookie, sessionExpiryMinutes } from './authCookie'

/**
 * Project override of the framework's default VerifyTwoFactorLoginAction.
 *
 * Identical challenge/TOTP verification, plus the same HttpOnly cookie
 * mirroring LoginAction/RegisterAction do — otherwise a 2FA-enabled user
 * completes the second step but the server-rendered dashboard can't see
 * their session. See Actions/Auth/authCookie.ts.
 *
 * Works today because migration 0000000032 supplies the two_factor_*
 * columns; dormant until an enrollment UI is added (there is no way to
 * turn 2FA on from settings yet), but wired so a 2FA-enabled account can
 * never lock itself out.
 */
export default new Action({
  name: 'VerifyTwoFactorLoginAction',
  description: 'Exchange a LoginAction 2FA challenge + TOTP code for a real token pack',
  method: 'POST',

  validations: {
    challenge_token: {
      rule: schema.string().min(1),
      message: 'A challenge token is required.',
    },
    code: {
      rule: schema.string().min(6).max(6),
      message: 'Code must be a 6-digit TOTP code.',
    },
  },

  async handle(request: RequestInstance) {
    const challengeToken = request.get('challenge_token')
    const code = request.get('code')

    // Single-use: a second attempt with the same challenge token
    // (whether the code was right or wrong) must start over from
    // LoginAction, not retry.
    const userId = await consumeTwoFactorChallenge(challengeToken)
    if (!userId)
      return response.unauthorized('This login attempt has expired — please sign in again.')

    const valid = await verifyTwoFactorLoginCode(userId, code)
    if (!valid)
      return response.unauthorized('Invalid code — please sign in again.')

    // Carry the "remember me" tier the user chose on step 1 through to the
    // session issued here, so a 2FA account is not silently downgraded to the
    // baseline week. The login page re-sends the checkbox with the TOTP code.
    const expiresInMinutes = sessionExpiryMinutes(request.get('remember'))
    const result = await Auth.loginUsingId(userId, { expiresInMinutes })
    if (!result)
      return response.unauthorized('Invalid code — please sign in again.')

    const user = result.user

    return response.json(
      {
        access_token: result.token,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        token: result.token,
        user: {
          id: user?.id,
          email: user?.email,
          name: user?.name,
        },
      },
      { status: 200, headers: { 'Set-Cookie': buildAuthCookie(result.token, result.expiresIn) } },
    )
  },
})
