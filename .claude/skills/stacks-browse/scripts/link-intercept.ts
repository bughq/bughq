#!/usr/bin/env bun
/**
 * Did the SPA router intercept this link, or did the browser navigate natively?
 *
 * `spa-probe.ts` cannot answer this. For a link whose target is not an stx page
 * — an OAuth redirect, a file download, an API route — the end state is
 * IDENTICAL either way: dead JS context, URL sitting on the target. The router
 * intercepts, fetches, fails to use the response, and falls back to a native
 * navigation. Indistinguishable from never having been intercepted, unless you
 * look at the network:
 *
 *   Fetch/XHR for the target -> intercepted (router called navigate())
 *   only a Document request  -> the browser handled the click natively
 *
 * That distinction is the whole point of `data-no-router`, so verifying such an
 * attribute with spa-probe produces a false pass. This measures it directly.
 *
 * Usage:
 *   bun link-intercept.ts <base> <page> <target-href>
 *
 * Example — prove an OAuth button escapes the router:
 *   bun link-intercept.ts http://localhost:3100 /login /api/auth/github/redirect
 *
 * Env:
 *   SETTLE_MS       ms to wait after the click (default 3000)
 *   SPA_COOKIE      "name=value" seeded before load, for auth-gated pages
 *   SPA_LOCALSTORAGE JSON object of key/value strings seeded before page scripts
 *                   run. App pages need BOTH: the cookie authenticates the
 *                   server render, and the client guard redirects to /login
 *                   unless the token is in localStorage too. Without it every
 *                   app page reports NO_LINK.
 *
 * Exit code is 0 when the link was NOT intercepted, 1 when it was, so it can
 * gate a check. Run it once with the attribute removed as a control: a probe
 * that reports "correct" in both directions is measuring nothing.
 */
import { Cdp, kill, launch, openPage } from './browse.ts'

const SETTLE_MS = Number(process.env.SETTLE_MS || 3000)
const COOKIE = process.env.SPA_COOKIE || ''
const LOCAL_STORAGE = process.env.SPA_LOCALSTORAGE || ''

const [base, page, target] = process.argv.slice(2)
if (!base || !page || !target) {
  console.error('usage: link-intercept.ts <base> <page> <target-href>')
  process.exit(2)
}

const s = await launch()
let intercepted = false
try {
  const cdp: Cdp = await openPage(s.port)
  const reqs: { type: string }[] = []
  // Match the pathname exactly, not a substring: a target of "/" substring-matches
  // every stylesheet, font and SSE request on the page and buries the signal.
  const wanted = (() => {
    try { return new URL(target, base).pathname }
    catch { return target }
  })()
  cdp.on((e) => {
    if (e.method !== 'Network.requestWillBeSent')
      return
    let p = ''
    try { p = new URL(String(e.params?.request?.url || ''), base).pathname }
    catch { return }
    if (p === wanted)
      reqs.push({ type: e.params.type || '?' })
  })
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  if (COOKIE) {
    const eq = COOKIE.indexOf('=')
    if (eq > 0) {
      let domain = 'localhost'
      try { domain = new URL(base).hostname }
      catch { /* keep default */ }
      await cdp.send('Network.setCookie', { name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), domain, path: '/' })
    }
  }
  if (LOCAL_STORAGE) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{var o=JSON.parse(${JSON.stringify(LOCAL_STORAGE)});for(var k in o)localStorage.setItem(k,o[k])}catch(e){}`,
    })
  }

  const loaded = cdp.waitFor('Page.loadEventFired', () => true, 20_000).catch(() => null)
  await cdp.send('Page.navigate', { url: base + page })
  await loaded
  await Bun.sleep(800)

  const info = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const a = document.querySelector('a[href="${target}"]')
      return JSON.stringify({
        found: !!a,
        noRouter: a ? a.hasAttribute('data-no-router') : null,
        stxLink: a ? a.hasAttribute('data-stx-link') : null,
        config: window.__stxRouterConfig || null,
      })
    })()`,
  })
  const anchor = JSON.parse(info.result.value)
  if (!anchor.found) {
    console.log(JSON.stringify({ page, target, result: 'NO_LINK' }, null, 2))
    process.exit(2)
  }

  reqs.length = 0
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('a[href="${target}"]').click()` })
  await Bun.sleep(SETTLE_MS)

  intercepted = reqs.some(r => r.type === 'Fetch' || r.type === 'XHR')
  console.log(JSON.stringify({
    page,
    target,
    result: intercepted ? 'INTERCEPTED' : 'NATIVE',
    // data-stx-link wins over data-no-router: the router matches [data-stx-link]
    // first and never consults shouldIntercept() for it, so both true means the
    // no-router attribute is being silently ignored.
    ...anchor,
    requestTypes: reqs.map(r => r.type),
  }, null, 2))
  cdp.close()
}
finally { kill(s) }

process.exit(intercepted ? 1 : 0)
