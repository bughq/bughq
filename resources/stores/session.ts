/**
 * Session state: who is signed in, and which project they are looking at.
 *
 * Both live in cookies rather than localStorage, and that is deliberate — the
 * server reads them. `bughq_token` is what every `<script server>` block
 * authenticates from via `requestContext.cookie('bughq_token')`, and
 * `bughq_project` is the browsing preference the dashboard and settings pages
 * resolve their active project from. A value only the client can see would be
 * useless to both.
 *
 * This replaces 17 hand-serialised `document.cookie` writes, which each re-typed
 * `path`, `max-age`, `samesite` and the `secure` conditional, and 5 reads that
 * built a RegExp from an unescaped cookie name. `useCookie` escapes the name for
 * its matcher (`signals.js:3573`) and owns the serialisation once.
 *
 * `useCookie` returns a `state()` signal in every shipped implementation and its
 * declaration says `Signal<string>` — verified, because the sibling
 * `useLocalStorage` declares `: void` while returning a ref
 * (stacksjs/stx#1795), so the contract is worth checking rather than assuming.
 */

// `useCookie` has to be reached through `window.stx` here, and that is a
// framework gap rather than a preference. store-loader.js strips every import
// from a store file, transpiles it, and wraps the result in a bare IIFE
// (`store-loader.js:50-68`) — it injects no auto-import prelude, unlike a .stx
// client block. So a store sees only what the runtime happens to attach to
// `window` itself: `defineStore` and `state` are there, the composables are not.
// Verified: `typeof useCookie` is `undefined` inside a store while
// `window.stx.useCookie` is a function.
const { useCookie } = window.stx

// Matches config/auth.ts tokenExpiry. The cookie must not outlive the token it
// carries: a cookie that survives longer just means the browser keeps sending a
// credential the server has already stopped accepting, which reads to the user
// as a random 401 rather than a clean sign-out.
const ONE_DAY = 60 * 60 * 24
const ONE_YEAR = 60 * 60 * 24 * 365

/** Only send `secure` over https — a secure cookie is dropped on http://localhost. */
function overHttps(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:'
}

// Consume it as `useStore('session')`, NOT by importing this name. The loader
// strips `export` and wraps the whole file in an IIFE, so the binding below never
// escapes — registration happens by id inside defineStore, and `useStore` reads
// the registry. The `export` keyword is kept only so this file is valid TS on its
// own; it has no effect on the bundle.
//
// Verified round trip in a browser: set -> cookie written -> read back ->
// authHeaders correct -> signOut clears both the signal and the cookie.
export const useSession = defineStore('session', () => {
  const token = useCookie('bughq_token', {
    maxAge: ONE_DAY,
    sameSite: 'Lax',
    secure: overHttps(),
  })

  const project = useCookie('bughq_project', {
    maxAge: ONE_YEAR,
    sameSite: 'Lax',
    secure: overHttps(),
  })

  /** Bearer headers for the owner-scoped /api endpoints. */
  function authHeaders(): AuthHeaders {
    return {
      'Authorization': `Bearer ${token()}`,
      'Content-Type': 'application/json',
    }
  }

  function signedIn(): boolean {
    return !!token()
  }

  /**
   * Revoke the token server-side, then clear both cookies. Setting a cookie
   * signal to '' makes useCookie emit `max-age=0` (`signals.js:3585`), which is
   * the delete, so there is no separate removal path to keep in step.
   *
   * The POST is what makes this a sign-out rather than a hide. Without it the
   * token stayed valid after "Log out" — anyone holding a copy (a shared
   * machine's history, a proxy log, a synced clipboard) could keep using it for
   * the full 30-day expiry. account.stx always called /logout; the header
   * button on every app page called this, which only dropped the cookie.
   *
   * Fire-and-forget and errors swallowed on purpose: a failed revoke must not
   * strand someone signed in on the client, and the local clear below is what
   * they can see. Read the token before clearing it — the request needs it.
   */
  function signOut(): void {
    const bearer = token()
    if (bearer) {
      fetch('/logout', { method: 'POST', headers: { Authorization: `Bearer ${bearer}` }, keepalive: true })
        .catch(() => {})
    }
    token.set('')
    project.set('')
  }

  return { token, project, authHeaders, signedIn, signOut }
})
