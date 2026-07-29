#!/usr/bin/env bun
/**
 * Fresh-vs-arrived screenshot capture.
 *
 * The oracle here is NOT a stored baseline — it's the same URL loaded directly,
 * seconds earlier, in the same browser with the same data and the same clock.
 * The only variable is the path taken. That catches the bug class baseline visual
 * testing structurally cannot see: a page that renders correctly on a direct load
 * but incorrectly when reached by a client-side navigation.
 *
 *   fresh <path> <out.png>          normal full page load (the reference)
 *   via   <from> <to> <out.png>     <to> reached by clicking a link on <from>
 *
 * Real defects this shape has caught in bughq:
 *   - previous page's chrome surviving the swap (nodes appended to document.body)
 *   - a class on <main> leaking into the next page, nesting a width constraint
 *   - a page arriving completely unstyled across a shell boundary
 *
 * Env:
 *   BASE             base URL (default http://localhost:3100)
 *   SPA_COOKIE       "name=value" seeded before load, for auth-gated routes
 *   SPA_LOCALSTORAGE JSON object of key/value strings seeded before page scripts run
 *   VIEWPORT         "WIDTHxHEIGHT" (default 1280x900)
 */
import { kill, launch, openPage } from './browse.ts'

const BASE = process.env.BASE || 'http://localhost:3100'
const COOKIE = process.env.SPA_COOKIE || ''
const LOCAL_STORAGE = process.env.SPA_LOCALSTORAGE || ''
const [vw, vh] = (process.env.VIEWPORT || '1280x900').split('x').map(Number)

const [mode, ...rest] = process.argv.slice(2)

const s = await launch()
try {
  const cdp = await openPage(s.port)
  const consoleErrors: string[] = []
  cdp.on((e) => {
    if (e.method === 'Runtime.exceptionThrown')
      consoleErrors.push(String(e.params?.exceptionDetails?.exception?.description || e.params?.exceptionDetails?.text))
    if (e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error')
      consoleErrors.push((e.params.args || []).map((a: any) => a.value ?? a.description ?? '').join(' '))
  })
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false })

  if (COOKIE) {
    const eq = COOKIE.indexOf('=')
    let domain = 'localhost'
    try { domain = new URL(BASE).hostname }
    catch { /* keep default */ }
    if (eq > 0)
      await cdp.send('Network.setCookie', { name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), domain, path: '/' })
  }
  if (LOCAL_STORAGE) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{var o=JSON.parse(${JSON.stringify(LOCAL_STORAGE)});for(var k in o)localStorage.setItem(k,o[k])}catch(e){}`,
    })
  }

  async function goto(path: string): Promise<void> {
    const loaded = cdp.waitFor('Page.loadEventFired', () => true, 20_000).catch(() => null)
    await cdp.send('Page.navigate', { url: BASE + path })
    await loaded
    await Bun.sleep(1200)
  }

  let out: string
  let target: string

  if (mode === 'fresh') {
    ;[target, out] = rest
    await goto(target)
  }
  else if (mode === 'via') {
    const [from, to, o] = rest
    target = to
    out = o
    await goto(from)
    consoleErrors.length = 0
    const r = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const a = [...document.querySelectorAll('a[href]')].find(x => {
          try { return new URL(x.getAttribute('href'), location.href).pathname === ${JSON.stringify(to)} }
          catch { return false }
        })
        if (!a) return 'NO_LINK'
        a.click()
        return 'CLICKED'
      })()`,
    })
    if (r.result.value === 'NO_LINK') {
      console.log(JSON.stringify({ ok: false, reason: `no link to ${to} on ${from}` }))
      process.exit(2)
    }
    await Bun.sleep(2000)
  }
  else {
    console.error('usage: spa-shot.ts fresh <path> <out.png>\n       spa-shot.ts via <from> <to> <out.png>')
    process.exit(1)
  }

  const state = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({
      at: location.pathname,
      mains: document.querySelectorAll('main').length,
      nested: document.querySelectorAll('main main').length,
      mainClass: (document.querySelector('main') || {}).className || '',
      h: document.documentElement.scrollHeight
    })`,
  })

  // Full-page capture so an overlay or duplicated-chrome artifact anywhere is visible.
  const metrics = await cdp.send('Page.getLayoutMetrics')
  const height = Math.min(Math.ceil(metrics.cssContentSize?.height || vh), 6000)
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: vw, height, scale: 1 },
  })
  await Bun.write(out, Buffer.from(shot.data, 'base64'))
  console.log(JSON.stringify({ ok: true, mode, target, out, state: JSON.parse(state.result.value), consoleErrors: consoleErrors.slice(0, 5) }))
}
finally { kill(s) }
