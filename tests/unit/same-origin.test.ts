/**
 * The CSRF origin guard.
 *
 * This shipped broken: it compared `Origin` against the request's Host header,
 * and rpx proxies to `localhost:3022` without setting any forwarded headers, so
 * the two could never match and every issue-resolve returned 403 in production.
 * It failed identically on the old dedicated box and the shared one, so nothing
 * about a deploy would ever have revealed it.
 *
 * These pin the property that matters: the answer depends on OUR configuration,
 * never on a header the proxy is free to rewrite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import process from 'node:process'
import { sameOrigin } from '../../app/Support/origin'

// State the configuration under test rather than inheriting whatever .env
// happens to say. The suite's own APP_URL is bughq.localhost, so a test that
// asserted anything about bughq.org while reading ambient config would be
// testing the environment, not the guard.
const saved = { url: process.env.APP_URL, domain: process.env.APP_DOMAIN }
beforeAll(() => {
  process.env.APP_URL = 'https://bughq.org'
  process.env.APP_DOMAIN = 'bughq.org'
})
afterAll(() => {
  saved.url === undefined ? delete process.env.APP_URL : (process.env.APP_URL = saved.url)
  saved.domain === undefined ? delete process.env.APP_DOMAIN : (process.env.APP_DOMAIN = saved.domain)
})

function req(headers: Record<string, string>): any {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: { get: (n: string) => lower[n.toLowerCase()] ?? null } }
}

describe('sameOrigin', () => {
  it('accepts our own origin even when the proxy rewrote Host', () => {
    // The exact production shape: rpx forwards to localhost and sets nothing.
    expect(sameOrigin(req({ origin: 'https://bughq.org', host: 'localhost:3022' }))).toBe(true)
  })

  it('accepts the www form, since the redirect happens after the browser sends Origin', () => {
    expect(sameOrigin(req({ origin: 'https://www.bughq.org', host: 'localhost:3022' }))).toBe(true)
  })

  it('rejects a third-party origin', () => {
    expect(sameOrigin(req({ origin: 'https://evil.example', host: 'localhost:3022' }))).toBe(false)
  })

  it('rejects an attacker-supplied Host that matches their own origin', () => {
    // The old implementation returned TRUE here: it compared the two values the
    // attacker controls against each other.
    expect(sameOrigin(req({ origin: 'https://evil.example', host: 'evil.example' }))).toBe(false)
  })

  it('ignores x-forwarded-host, which a direct client can forge', () => {
    expect(sameOrigin(req({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }))).toBe(false)
  })

  it('allows a request with no Origin at all', () => {
    // curl, server-to-server, same-origin GET. Auth still guards these.
    expect(sameOrigin(req({ host: 'localhost:3022' }))).toBe(true)
  })

  it('rejects a malformed Origin', () => {
    expect(sameOrigin(req({ origin: 'not-a-url', host: 'bughq.org' }))).toBe(false)
  })
})
