import type { AuthConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * **Authentication Configuration**
 *
 * This configuration defines all of your authentication options. Because Stacks is fully-typed,
 * you may hover any of the options below and the definitions will be provided. In case
 * you have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  enabled: true,

  /**
   * The authentication guard to use for your application.
   */
  default: 'api',

  /**
   * The authentication guards available for your application.
   */
  guards: {
    api: {
      driver: 'token',
      provider: 'users',
    },
  },

  /**
   * The authentication providers available for your application.
   */
  providers: {
    users: {
      driver: 'database',
      table: 'users',
    },
  },

  /**
   * The username field used for authentication.
   */
  username: env.AUTH_USERNAME_FIELD || 'email',

  /**
   * The password field used for authentication.
   */
  password: env.AUTH_PASSWORD_FIELD || 'password',

  /**
   * Access-token expiry in milliseconds (default: 1 hour).
   *
   * Access tokens are deliberately short-lived: a leaked bearer (logs,
   * proxy, browser storage) is then usable for an hour, not a month. The
   * paired refresh token (`refreshTokenExpiry`) carries the long-lived
   * session and is rotated on use, so UX is unaffected.
   */
  // 24 hours, absolute. Not a sliding window: the clock starts when the token is
  // issued and is never extended by activity, so a session ends a day after
  // sign-in whatever the user was doing. There is deliberately no idle expiry —
  // being away from the keyboard does not end a session, reaching 24h does.
  //
  // The refresh token below carries the same 24h, so refreshing cannot outlive
  // it either; a longer refresh window would make this number cosmetic.
  tokenExpiry: env.AUTH_TOKEN_EXPIRY || 24 * 60 * 60 * 1000,

  /**
   * Refresh-token expiry in milliseconds. Held at 24h to match `tokenExpiry` —
   * the refresh token is what a session's real length is measured by, so
   * leaving it at 30 days would let a 24h access token be renewed for a month.
   */
  refreshTokenExpiry: env.AUTH_REFRESH_TOKEN_EXPIRY || 24 * 60 * 60 * 1000,

  /**
   * The token rotation time in hours (default: 24 hours).
   */
  tokenRotation: env.AUTH_TOKEN_ROTATION || 24,

  /**
   * The token abilities that are granted by default.
   */
  defaultAbilities: ['*'],

  /**
   * The token name used when creating new tokens.
   */
  defaultTokenName: 'auth-token',

  /**
   * Password reset configuration.
   */
  passwordReset: {
    /**
     * Where the emailed reset link points. `{token}` and `{email}` are
     * filled in by the framework's password-reset sender.
     *
     * TEMPORARY: absolute local URL for the local-dev phase; switch to the
     * path template '/reset-password?token={token}&email={email}' at launch
     * so it resolves against the deployed app URL.
     */
    url: env.AUTH_PASSWORD_RESET_URL || `${/^https?:\/\//.test(String(env.APP_URL || '')) ? String(env.APP_URL).replace(/\/$/, '') : 'http://localhost:3100'}/reset-password?token={token}&email={email}`,

    /**
     * Token expiration time in minutes.
     * After this time, the reset link becomes invalid.
     *
     * @default 60
     */
    expire: env.AUTH_PASSWORD_RESET_EXPIRE ||60,

    /**
     * Throttle time in seconds between password reset requests.
     * Users must wait this long before requesting another reset email.
     *
     * @default 60
     */
    throttle: env.AUTH_PASSWORD_RESET_THROTTLE ||60,
  },
} satisfies AuthConfig
