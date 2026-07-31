// Site metadata + SEO. `buddy serve` loads this and injects the tags a page has
// not already declared: canonical, Open Graph, Twitter card, favicon.
//
// It is NOT the source of titles or descriptions any more. Every page declares
// both through useSeoMeta() in its own <script server> block, which also derives
// og:* and twitter:* from the same two strings so they cannot drift. injectSeo
// skips anything already declared (site-builder/seo.js:21-30), so the page wins.
//
// `pages` is therefore reduced to genuine per-route overrides. It previously
// carried a duplicate title and description for ten routes, which had already
// drifted: /use-cases disagreed with its own page. Adding an entry here to fix a
// title will do nothing — edit the page's useSeoMeta call.
//
// The authenticated routes that used to be listed (/dashboard, /account) are
// gone: they were minting canonical and og tags for URLs a signed-out visitor
// cannot load. Those pages now declare robots: 'noindex, nofollow'.
const description = 'Error tracking for people who ship. Capture, group, and triage production errors with automatic fingerprinting. Built on Stacks and Postgres.'

export default {
  name: 'bughq',
  url: 'https://bughq.org',
  description,
  seo: {
    siteName: 'bughq',
    title: 'bughq - Error tracking for people who ship',
    description,
    image: 'https://bughq.org/og.png',
    favicon: '/favicon.svg',
    locale: 'en_US',
    type: 'website',
    twitter: 'stacksjs',
  },
  // Per-route overrides only. Empty today — every route's title and description
  // live on the page. Add an entry here only for something a page cannot express,
  // such as a route-specific `image`.
  pages: {},
}
