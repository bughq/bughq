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
   * Token expiry in milliseconds — the 7-day BASELINE session (default).
   *
   * This is the entry-point default used where no per-login tier is chosen
   * (registration, social sign-in). Interactive logins set the real session
   * length per request from the "Keep me signed in" checkbox via
   * `sessionExpiryMinutes()` (app/Actions/Auth/authCookie.ts) and
   * `Auth.loginUsingId(id, { expiresInMinutes })`: unchecked -> 7 days,
   * checked -> 30 days. That single number stamps BOTH the
   * `oauth_access_tokens.expires_at` row and the HttpOnly `auth-token`
   * cookie's Max-Age (via `buildAuthCookie(token, result.expiresIn)`), so the
   * whole session honours the tier — not just the cookie. Nothing slides or
   * extends it afterwards, so this is the real cap. The user keeps a
   * never-log-out feel by checking "Keep me signed in", not by a long
   * baseline. AUTH_TOKEN_EXPIRY overrides the baseline per environment.
   */
  tokenExpiry: env.AUTH_TOKEN_EXPIRY || 7 * 24 * 60 * 60 * 1000,

  /**
   * Refresh-token expiry in milliseconds. NOT WIRED UP — there is no refresh
   * exchange in this app (no /auth/refresh route, no client refresh loop); the
   * session length is the `expiresInMinutes` stamped at login, and it is never
   * renewed. Kept only because the framework AuthConfig type carries the field.
   */
  refreshTokenExpiry: env.AUTH_REFRESH_TOKEN_EXPIRY || 7 * 24 * 60 * 60 * 1000,

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
