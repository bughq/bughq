// Site metadata + SEO. `buddy serve` loads this and injects canonical, Open
// Graph, and Twitter card tags per page. Per-path overrides live in `pages`.
//
// It does NOT set <title>, despite the `title` keys below — injectSeo skips any
// tag the head already declares, and by the time it runs every page has one.
// `title` here only feeds og:title / twitter:title. The page owns <title>, via
// useHead() in a <script server> block; see the note in config/ui.ts.
//
// So keep a `pages` title in step with the page's own useHead title. A route
// missing from `pages` still renders its correct <title>; it just falls back to
// the generic site-wide og:title when shared.
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
  pages: {
    '/': {
      title: 'bughq - Error tracking for people who ship',
      description,
    },
    '/dashboard': {
      title: 'Issues - bughq',
      description: 'Grouped production errors with live counts, affected-user tallies, and severity triage.',
    },
    '/account': {
      title: 'Account - bughq',
      description: 'Your bughq profile, plan, and sign-in method.',
    },
    '/use-cases': {
      title: 'Use cases - bughq',
      description: 'How SaaS teams, on-call engineers, agencies, indie devs, and open-source maintainers use bughq to catch and triage production errors.',
    },
    '/features/capture': {
      title: 'Automatic error capture - bughq',
      description: 'Initialize once and every uncaught error is captured with its stack trace, release, and environment. No scattered try/catch.',
    },
    '/features/grouping': {
      title: 'Fingerprint grouping - bughq',
      description: 'Identical errors fold into a single issue by fingerprint, with a live event count and an affected-user tally.',
    },
    '/features/releases': {
      title: 'Releases and environments - bughq',
      description: 'Tag every event with a release and environment so a regression points straight at the deploy that caused it.',
    },
    '/features/stack-traces': {
      title: 'Readable stack traces - bughq',
      description: 'Upload a source map and every minified frame resolves back to your original file, function, and line.',
    },
    '/features/alerts': {
      title: 'Alerts and triage - bughq',
      description: 'Get alerted when an issue is new or spiking, and stay quiet for the known and handled. Tune the threshold, not the noise.',
    },
    '/features/self-host': {
      title: 'Self-hosting - bughq',
      description: 'bughq is open source and runs on your own Postgres, so sensitive stack data never leaves servers you control.',
    },
  },
}
