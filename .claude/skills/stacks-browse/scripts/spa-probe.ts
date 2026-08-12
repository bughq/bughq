#!/usr/bin/env bun
/**
 * SPA navigation probe — decides, per route and per navigation, whether the stx
 * client router actually swapped a fragment or the browser did a full reload.
 *
 * Detection is by **JS-context survival**, not by CDP event timing: we stamp
 * `window.__spaProbe` before the click and check whether it survives. If it does,
 * the document was preserved => SPA fragment swap. If it's gone, the document was
 * torn down => full navigation. This is timing-independent, which is where this
 * kind of harness normally goes flaky.
 *
 * Usage:
 *   bun spa-probe.ts routes <base> <path...>          # per-route audit
 *   bun spa-probe.ts navs   <base> <from>::<to> ...   # per-navigation audit
 *
 * Env:
 *   SETTLE_MS       ms to wait after a click (default 1400; use ~5000 for remote hosts)
 *   SPA_COOKIE      "name=value" seeded before load, for auth-gated routes
 *   SPA_LOCALSTORAGE JSON object of key/value strings seeded before any page script runs
 *
 * Results per navigation:
 *   SPA               fragment swap (JS context preserved)
 *   FULL_RELOAD       document torn down — correct for deliberate boundaries
 *   DID_NOT_NAVIGATE  clicked, but the URL never changed
 *   NO_LINK           no anchor to the target exists on the page
 */
import { Cdp, kill, launch, openPage } from './browse.ts'

// Remote hosts need a longer post-click settle than localhost: the router's fetch
// is a real network round-trip, and reading location.pathname too early reports a
// false "did not navigate".
const SETTLE_MS = Number(process.env.SETTLE_MS || 1400)
const COOKIE = process.env.SPA_COOKIE || ''
const LOCAL_STORAGE = process.env.SPA_LOCALSTORAGE || ''

/** Most app routes bounce to a login page unless auth is seeded before page scripts run. */
async function seedAuth(cdp: Cdp, origin: string): Promise<void> {
  if (COOKIE) {
    const eq = COOKIE.indexOf('=')
    if (eq > 0) {
      let domain = 'localhost'
      try { domain = new URL(origin).hostname }
      catch { /* keep default */ }
      await cdp.send('Network.setCookie', {
        name: COOKIE.slice(0, eq),
        value: COOKIE.slice(eq + 1),
        domain,
        path: '/',
      })
    }
  }
  if (LOCAL_STORAGE) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{var d=${JSON.stringify(LOCAL_STORAGE)};var o=JSON.parse(d);for(var k in o)localStorage.setItem(k,o[k])}catch(e){}`,
    })
  }
}

/** Everything we can learn about a rendered page without screenshotting it. */
const INSPECT = `(() => {
  const lg = document.querySelector('meta[name="stx-layout-group"]')
  const links = [...document.querySelectorAll('a[href]')]
    .map(a => { try { return new URL(a.getAttribute('href'), location.href) } catch { return null } })
    .filter(u => u && u.origin === location.origin)
    .map(u => u.pathname)
  return JSON.stringify({
    at: location.pathname + location.search,
    mains: document.querySelectorAll('main').length,
    nestedMains: document.querySelectorAll('main main').length,
    mainClass: (document.querySelector('main') || {}).className || '',
    layoutGroup: lg ? lg.getAttribute('content') : null,
    fullDoc: !!document.doctype,
    headTagsInBody: document.body
      ? document.body.querySelectorAll('link[rel="stylesheet"], style, meta, title').length
      : 0,
    internalLinks: [...new Set(links)],
  })
})()`

async function newPage(port: number, origin: string) {
  const cdp = await openPage(port)
  const errors: string[] = []
  cdp.on((e) => {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params?.exceptionDetails
      errors.push(String(d?.exception?.description || d?.text || 'exception'))
    }
    if (e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error')
      errors.push((e.params.args || []).map((a: any) => a.value ?? a.description ?? '').join(' '))
  })
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await seedAuth(cdp, origin)
  return { cdp, errors }
}

async function goto(cdp: Cdp, url: string): Promise<number | null> {
  let status: number | null = null
  cdp.on((e) => {
    if (e.method === 'Network.responseReceived' && e.params?.type === 'Document' && status == null)
      status = e.params.response.status
  })
  const loaded = cdp.waitFor('Page.loadEventFired', () => true, 20_000).catch(() => null)
  await cdp.send('Page.navigate', { url })
  await loaded
  await Bun.sleep(600)
  return status
}

async function evalJson(cdp: Cdp, expr: string): Promise<any> {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails)
    return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
  return JSON.parse(r.result.value)
}

async function auditRoutes(base: string, paths: string[]): Promise<void> {
  const s = await launch()
  const out: any[] = []
  try {
    for (const p of paths) {
      const { cdp, errors } = await newPage(s.port, base)
      try {
        const status = await goto(cdp, base + p)
        out.push({ path: p, status, ...(await evalJson(cdp, INSPECT)), consoleErrors: errors.slice(0, 6) })
      }
      catch (e: any) {
        out.push({ path: p, status: null, mains: -1, consoleErrors: [String(e.message)] })
      }
      finally { cdp.close() }
    }
  }
  finally { kill(s) }
  console.log(JSON.stringify(out, null, 2))
}

async function auditNavs(base: string, pairs: string[]): Promise<void> {
  const s = await launch()
  const out: any[] = []
  try {
    for (const pair of pairs) {
      const [from, to] = pair.split('::')
      const { cdp, errors } = await newPage(s.port, base)
      try {
        await goto(cdp, base + from)
        const before = await evalJson(cdp, INSPECT)
        await cdp.send('Runtime.evaluate', { expression: `window.__spaProbe = 'alive'` })
        errors.length = 0

        // element.click(), NOT synthetic mouse coordinates: the click bubbles to the
        // router's document listener identically, and it works for links below the
        // fold or inside hover-only menus. Coordinate clicks silently miss those and
        // report a false DID_NOT_NAVIGATE.
        // Match on pathname+search when the target carries a query string, and on
        // pathname alone otherwise. Pathname-only matching cannot express a
        // same-path navigation — a filter tab going to /dashboard?status=resolved
        // reduced to the pathname '/dashboard', matched nothing, and reported
        // NO_LINK. That reads as "no such link", not "this probe cannot see it",
        // so a whole class of full-reload bug on query-only links passed silently.
        // Query-only navigations are exactly where interceptAllLinks:false bites,
        // since they are the links most likely to be written as plain anchors.
        const clicked = await evalJson(cdp, `(() => {
          const target = ${JSON.stringify(to)}
          const withQuery = target.includes('?')
          const a = [...document.querySelectorAll('a[href]')].find(x => {
            try {
              const u = new URL(x.getAttribute('href'), location.href)
              return (withQuery ? u.pathname + u.search : u.pathname) === target
            }
            catch { return false }
          })
          if (!a) return JSON.stringify({ found: false })
          a.click()
          return JSON.stringify({ found: true })
        })()`)

        if (!clicked.found) {
          out.push({ from, to, result: 'NO_LINK', note: 'no anchor to target on page' })
          continue
        }

        await Bun.sleep(SETTLE_MS)
        const after = await evalJson(cdp, `(() => {
          const o = JSON.parse(${INSPECT})
          o.marker = window.__spaProbe || null
          return JSON.stringify(o)
        })()`)

        // `at` is pathname+search, so a pathname-only target has to be compared
        // against the pathname half or every navigation to a page that keeps a
        // query string reports a false DID_NOT_NAVIGATE.
        const arrived = to.includes('?') ? after.at === to : after.at.split('?')[0] === to
        out.push({
          from,
          to,
          arrived,
          result: !arrived ? 'DID_NOT_NAVIGATE' : after.marker === 'alive' ? 'SPA' : 'FULL_RELOAD',
          mainsBefore: before.mains,
          mainsAfter: after.mains,
          nestedMainsAfter: after.nestedMains,
          mainClassBefore: before.mainClass,
          mainClassAfter: after.mainClass,
          groupBefore: before.layoutGroup,
          groupAfter: after.layoutGroup,
          consoleErrors: errors.slice(0, 6),
        })
      }
      catch (e: any) { out.push({ from, to, result: 'ERROR', note: String(e.message) }) }
      finally { cdp.close() }
    }
  }
  finally { kill(s) }
  console.log(JSON.stringify(out, null, 2))
}

const [cmd, base, ...rest] = process.argv.slice(2)
if (cmd === 'routes' && base)
  await auditRoutes(base, rest)
else if (cmd === 'navs' && base)
  await auditNavs(base, rest)
else {
  console.error('usage: spa-probe.ts routes <base> <path...>\n       spa-probe.ts navs <base> <from>::<to> ...')
  process.exit(1)
}
