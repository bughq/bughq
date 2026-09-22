/**
 * Browsing state: which project the user is currently looking at.
 *
 * The session itself is NOT here — it lives in a single HttpOnly `auth-token`
 * cookie minted server-side (app/Actions/Auth/authCookie.ts) that JavaScript
 * cannot read or write. Every `<script server>` block and every owner-scoped
 * API route authenticates from that cookie; the client sends it automatically
 * with `credentials:'same-origin'` and holds no bearer token at all.
 *
 * `bughq_project` is the one cookie the client still owns: the browsing
 * preference the dashboard and settings project switchers resolve their active
 * project from. The server reads it too, so it stays a cookie rather than
 * localStorage.
 *
 * `useCookie` escapes the cookie name for its matcher (`signals.js:3573`) and
 * owns the serialisation (`path`, `max-age`, `samesite`, the `secure`
 * conditional) once, replacing hand-rolled `document.cookie` writes.
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
export const useSession = defineStore('session', () => {
  const project = useCookie('bughq_project', {
    maxAge: ONE_YEAR,
    sameSite: 'Lax',
    secure: overHttps(),
  })

  return { project }
})
