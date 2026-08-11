import { passwordResets } from '@stacksjs/auth'
import { response, route } from '@stacksjs/router'

/**
 * Auth endpoints, re-registered at the root with `.skipCsrf()`.
 *
 * These use the framework's default Auth actions (resolved by string), but the
 * defaults are CSRF-gated — which blocks the same-origin `fetch()` from the
 * login/register pages. Token auth is CSRF-immune (bearer tokens aren't sent
 * automatically by the browser the way cookies are), so skipping CSRF here is
 * safe; the rate limits are kept. User route files load before the framework
 * defaults, so these win on the duplicate method+path.
 */
route.post('/login', 'Actions/Auth/LoginAction').skipCsrf().rateLimit(5, 'minute')
route.post('/register', 'Actions/Auth/RegisterAction').skipCsrf().rateLimit(3, 'minute')
route.post('/logout', 'Actions/Auth/LogoutAction').skipCsrf()
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

// Social sign-in (GitHub, Google) via the native @stacksjs/socials drivers.
// GET flows, CSRF-exempt; provider credentials come from config/services.ts.
route.get('/api/auth/{provider}/redirect', 'Actions/Auth/SocialRedirectAction').skipCsrf()
route.get('/api/auth/{provider}/callback', 'Actions/Auth/SocialCallbackAction').skipCsrf()

// Billing (Stripe). Checkout requires an authenticated user (bearer token);
// the webhook is a Stripe callback so it skips CSRF and auth.
route.post('/payments/checkout', 'Actions/Payment/CreateCheckoutAction').middleware('auth').skipCsrf()
route.post('/webhooks/stripe', 'Actions/StripeWebhook').skipCsrf()
