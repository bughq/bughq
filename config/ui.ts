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
} satisfies UiOptions
