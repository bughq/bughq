import { passwordResets } from '@stacksjs/auth'
import { response, route } from '@stacksjs/router'

/**
 * Auth endpoints, re-registered at the root with `.skipCsrf()`.
 *
 * These resolve to the app's own actions in app/Actions/Auth/* (LoginAction,
 * RegisterAction, LogoutAction, VerifyTwoFactorLoginAction) — user route files
 * load before the framework defaults, so these win on the duplicate
 * method+path. Each minted session lives in a single HttpOnly `auth-token`
 * cookie (buildAuthCookie); the client holds no bearer.
 *
 * CSRF: the auth cookie is SameSite=Lax and the client sends no double-submit
 * token, so CSRF is skipped here (SameSite is the cross-site guard) and the
 * same-origin `fetch()` from the login/register pages is not blocked. Rate
 * limits are kept.
 */
route.post('/login', 'Actions/Auth/LoginAction').skipCsrf().rateLimit(5, 'minute')
route.post('/register', 'Actions/Auth/RegisterAction').skipCsrf().rateLimit(3, 'minute')
// Second step for a 2FA-enabled account: exchange the LoginAction challenge +
// TOTP code for a real session. Dormant until an enrollment UI exists, but
// wired so an enabled account can never lock out.
route.post('/verify-two-factor-login', 'Actions/Auth/VerifyTwoFactorLoginAction').skipCsrf().rateLimit(10, 'minute')
// .middleware('auth') so the cookie is validated and Auth.logout() revokes the
// exact token behind this session; keep skipCsrf (no CSRF token in play).
route.post('/logout', 'Actions/Auth/LogoutAction').middleware('auth').skipCsrf()
route.get('/api/me', 'Actions/MeAction').skipCsrf()

// Password reset. The send side uses the framework's passwordResets helper
// directly: it is anti-enumeration by design (unknown emails are a silent
// no-op), so this endpoint always answers with the same message and never
// reveals whether an account exists. The reset side reuses the framework's
// default action (hashed single-use tokens, expiry, session revocation).
// The emailed link points at /reset-password (config/auth.ts passwordReset.url).
route.post('/password/forgot', (request: any) => {
  const email = String((request.jsonBody ?? {}).email ?? '').trim().toLowerCase()
  const uniform = { success: true, message: 'If an account exists for that email, a reset link is on its way.' }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return response.json(uniform)
  // Identical bodies were only half of anti-enumeration — the clock was the
  // other half, and it was leaking. sendEmail() returns from its first query
  // when the address is unknown; a known one goes on to bcrypt a reset token
  // and hand the mail to the transport. Awaited, that measured 0.247s against
  // 0.0015s, so response time answered the question the body refuses to.
  //
  // Detaching equalises the two at the FAST number rather than padding the real
  // path out to the slow one, and the send still happens: same fire-and-forget
  // the invite (routes/projects.ts) and alert (routes/errors.ts) mails use.
  // Nothing downstream waits on it — the reply is fixed text either way.
  //
  // The .catch is what keeps this honest: without it a transport failure is an
  // unhandled rejection, and it must stay a server-log line rather than
  // anything the caller can observe.
  passwordResets(email).sendEmail()
    .catch(err => console.error('[password/forgot] send failed:', err instanceof Error ? err.message : err))
  return response.json(uniform)
}).skipCsrf().rateLimit(3, 'minute')
route.post('/password/reset', 'Actions/Password/PasswordResetAction').skipCsrf().rateLimit(5, 'minute')
// Lets reset-password.stx ask whether a link is still good before it asks for a
// password. Same verifyToken() the reset itself runs, so a token this accepts
// and a token that resets cannot disagree. It answers 400 for an expired or
// already-used token and 422 for a malformed request, which is only ever a
// fact about the link in the URL: the caller is holding the token, so there is
// nothing here an attacker could learn that they do not already have. The
// limit is looser than the reset's because a page load spends one.
route.post('/password/verify-token', 'Actions/Password/VerifyResetTokenAction').skipCsrf().rateLimit(10, 'minute')

// Two-factor enrollment for the account page. These are the framework's own
// JSON actions (storage/framework/defaults/app/Actions/Auth), registered here
// explicitly rather than left to framework-default registration - an app route
// that names the action is not at the mercy of whether the default is mounted,
// which is the shadowing trap that has bitten this estate before.
//
// generate-two-factor-secret makes a fresh secret, stashes it server-side with
// a short TTL, and returns the otpauth URI + secret for the authenticator app;
// enable-two-factor verifies the 6-digit code against that stash and only then
// writes users.two_factor_secret, so the server never trusts a client-supplied
// secret; disable-two-factor re-confirms the account password first, because
// turning a second factor off is the first thing a session thief would try.
//
// skipCsrf + middleware('auth') match /logout: the dashboard fetches are
// same-origin with the HttpOnly auth-token cookie (SameSite is the cross-site
// guard, so no double-submit token), and the middleware validates that cookie
// and populates request.user() for the actions.
route.post('/generate-two-factor-secret', 'Actions/Auth/GenerateTwoFactorSecretAction').middleware('auth').skipCsrf().rateLimit(10, 'minute')
route.post('/enable-two-factor', 'Actions/Auth/EnableTwoFactorAction').middleware('auth').skipCsrf().rateLimit(10, 'minute')
route.post('/disable-two-factor', 'Actions/Auth/DisableTwoFactorAction').middleware('auth').skipCsrf().rateLimit(10, 'minute')

// Social sign-in (GitHub, Google) via the native @stacksjs/socials drivers.
// GET flows, CSRF-exempt; provider credentials come from config/services.ts.
route.get('/api/auth/{provider}/redirect', 'Actions/Auth/SocialRedirectAction').skipCsrf()
route.get('/api/auth/{provider}/callback', 'Actions/Auth/SocialCallbackAction').skipCsrf()

// Billing (Stripe). Checkout requires an authenticated user (bearer token);
// the webhook is a Stripe callback so it skips CSRF and auth.
route.post('/payments/checkout', 'Actions/Payment/CreateCheckoutAction').middleware('auth').skipCsrf()
route.post('/webhooks/stripe', 'Actions/StripeWebhook').skipCsrf()
