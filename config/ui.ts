import type { StxOptions as UiOptions } from '@stacksjs/stx'

/**
 * STX Configuration for Stacks
 * Note: Dashboard mode overrides these settings via serve() options
 */

export default {
  // Components directory - for user-defined components
  componentsDir: 'resources/components',

  // Layouts directory - for layout templates
  layoutsDir: 'resources/layouts',

  // Partials directory - for partial templates
  partialsDir: 'resources/partials',

  // SPA router. Both values are load-bearing and deliberately explicit.
  //
  // `container: 'main'` is the single element the router swaps. Every app page
  // is a bare fragment rendered into the <main> in layouts/default.stx.
  //
  // `interceptAllLinks: true` makes the router treat any same-origin <a> as an
  // SPA navigation. App pages don't need it — they declare intent with
  // <StxLink>, which the router matches first via [data-stx-link]. The 24
  // marketing pages do: their nav and footer (resources/partials/SiteNav.stx,
  // SiteFooter.stx) are ~64 plain anchors, and turning this off drops every
  // marketing navigation back to a full page load. Verified, not assumed:
  // spa-probe reports 8/8 marketing navigations SPA with this true.
  //
  // Pinned here rather than inherited because the defaults disagree —
  // stx-router's own default is `false` and bun-plugin-stx's serve path
  // hardcodes `true` on top of it. Relying on that would put bughq's whole
  // marketing SPA at the mercy of a dependency's internal default.
  //
  // The cost of `true` is that links which must NOT be intercepted have to say
  // so with `data-no-router`: the app -> marketing boundary links (marketing
  // CSS lives in a <head> the swap never brings, so the page arrives unstyled)
  // and the /api/auth/*/redirect OAuth links (server redirects — a fragment
  // fetch would swallow them instead of navigating).
  router: {
    container: 'main',
    interceptAllLinks: true,
  },

  // Last-resort <title>. Only reached by a page that declares none of its own —
  // its job is to make that failure read as "bughq" rather than "stx App".
  //
  // How a title is actually chosen (stx process.ts, the autoShell branch):
  //
  //   useHead({ title }) in <script server>   ← what every app page here uses
  //     -> @head's <title>
  //       -> @section('title')
  //         -> this value
  //           -> stx's own "stx App" default
  //
  // Two traps this replaced, both of which shipped a wrong <title> to prod:
  //
  // 1. `const meta = { title }` in a server script does nothing on an app page.
  //    injectSeoTags reads it, but it runs BEFORE the document shell exists and
  //    returns early on a fragment with no <head>. Four pages carried a dead
  //    `meta` const this way. useHead is the one that survives, because it
  //    writes context.__stx_runtime_head, which the shell reads.
  //
  // 2. site.config.ts cannot supply a <title> either. Its injectSeo skips any
  //    tag already declared in the head, and by then the shell has written its
  //    default — which is why prod served <title>stx App</title> next to a
  //    correct <meta property="og:title">. site.config still owns og/twitter/
  //    canonical; the page owns <title>.
  //
  // Setting the title here also fixes SPA navigation for free: the dev server
  // reads the rendered <title> into the X-STX-Title response header and the
  // router applies it on fragment swaps.
  app: {
    head: {
      title: 'bughq',
    },
  },
} satisfies UiOptions
