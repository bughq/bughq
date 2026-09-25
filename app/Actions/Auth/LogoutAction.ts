import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { clearAuthCookie } from '../../Support/authCookie'

/**
 * Project override of the framework's default LogoutAction — same
 * token revocation, plus clearing the HttpOnly `auth-token` cookie
 * LoginAction sets (see its doc comment for why the cookie exists at all).
 */
export default new Action({
  name: 'LogoutAction',
  description: 'Logout from the application',
  method: 'POST',
  async handle(request: RequestInstance) {
    await Auth.logout()

    const clearCookie = clearAuthCookie()

    // The dashboard/account sign-out is a same-origin `fetch('/logout')` that
    // then redirects the browser itself, but a plain full-page navigation
    // (Accept: text/html) should not render the raw JSON payload — 302 those
    // to /login. XHR/API callers (Accept: application/json) still get JSON.
    const accept = String(request.headers?.get?.('accept') ?? '')
    if (accept.includes('text/html')) {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/login', 'Set-Cookie': clearCookie },
      })
    }

    return response.json(
      { message: 'Successfully logged out' },
      { status: 200, headers: { 'Set-Cookie': clearCookie } },
    )
  },
})
