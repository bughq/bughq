import type { StxOptions as UiOptions } from '@stacksjs/stx'

/**
 * STX Configuration for Stacks
 * Note: Dashboard mode overrides these settings via serve() options
 */

export default {
  // Where the app lives. Pinned rather than inferred, and that matters:
  // resolveStxRoot (config.js:363-373) only returns root 'resources' because
  // BOTH resources/views and resources/layouts exist on disk. The second is an
  // empty directory that exists for no other reason, so the whole app's root
  // resolution rested on a folder nobody could see the purpose of — delete it
  // without pinning this and root silently becomes '.' with pagesDir 'pages'.
  root: 'resources',
  pagesDir: 'views',

  // The three below are joined onto `root` (config.js:411-418), so they are
  // relative to it. They previously repeated the `resources/` prefix and
  // therefore resolved to resources/resources/* — three directories that have
  // never existed. Nothing broke visibly because the dev and production serve
  // paths both pass their own values (dev/views.js:71-73,
  // production-server.js:121-123), so these were dead config being silently
  // overridden. If a future caller stops passing them, these must be right.
  componentsDir: 'components',
  layoutsDir: 'views/layouts',
  partialsDir: 'partials',

  // NOT root-prefixed by the block above — store-loader.js:11 resolves it
  // against `root` itself, so this is resources/stores.
  storesDir: 'stores',

  // Unlocks the 45 UI component groups in @stacksjs/components. Without this
  // the package is installed but every tag is unresolvable, which is why the
  // app hand-rolls its own dialog, switch, badge, button and breadcrumb.
  // Reaches the renderer via config.js:420-468 -> _pluginComponentDirs.
  plugins: ['@stacksjs/components/stx-plugin'],

  // Enforces "no vanilla DOM" mechanically instead of by documentation.
  // AGENTS.md has said it in prose the whole time and 68 violations shipped
  // anyway. failOnViolation stays FALSE deliberately: those 68 exist today, so
  // failing the build now would block all work. The warnings are the migration
  // queue; flip this to true once the queue is empty.
  strict: {
    enabled: true,
    failOnViolation: false,
    // Pre-paint auth and theme guards legitimately need these — they must run
    // before render and their whole job is to leave the page.
    allowPatterns: [
      'location.replace',
      'location.reload',
    ],
  },

  // SPA router. Both values are load-bearing and deliberately explicit.
  //
  // `container: 'main'` is the single element the router swaps. Every page is a
  // fragment rendered into the <main> of its layout.
  //
  // `interceptAllLinks: false` — SPA navigation is now opted INTO, by writing
  // <StxLink>, rather than applied to every anchor and opted out of. 263 links
  // were converted to reach this point; the only plain <a href="/…"> left are
  // the four /api/auth/*/redirect ones.
  //
  // This was previously `true` and documented as impossible to turn off,
  // because the marketing site's nav and footer were plain anchors and the flag
  // was the only thing making them navigate. Converting them removed that
  // dependency. The `data-no-router` escape hatches on the app -> marketing
  // links went with it: those pages now report `stx-layout-group`, and the
  // router already full-reloads on a group change of its own accord
  // (stx-router/dist/client.js:255-257), so the boundary is handled by the
  // framework instead of by an attribute on every link.
  //
  // The OAuth links keep `data-no-router` permanently. They are server
  // redirects, not a layout change, so the group check does not catch them and
  // a fragment fetch would swallow the redirect instead of following it.
  //
  // Pinned rather than inherited because the defaults disagree — stx-router's
  // own default is `false` and bun-plugin-stx's serve path hardcodes `true` on
  // top of it. Leaving it implicit would mean a dependency's internal default
  // decides whether this app is an SPA.
  router: {
    container: 'main',
    interceptAllLinks: false,
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
    // Pre-paint color mode (stacksjs/stx#1794). This emits a synchronous script
    // as the FIRST thing in <head> — above the stylesheets, because a <link>
    // ahead of it would block its execution and delay the one thing it exists to
    // do early. It also publishes these options on window.__STX_COLOR_MODE__, so
    // a bare useColorMode() in a store agrees with whatever already landed on
    // <html> instead of re-reading a different key and undoing it on hydration.
    //
    // storageKey is bughq's existing key, so nobody's saved preference is lost.
    // attribute is what marketing.css and every app page's CSS already select on
    // (:root[data-theme="dark"]). darkClass is null because nothing in this app
    // styles off a `dark` class — opting out explicitly rather than letting the
    // 'dark' default add a class no stylesheet reads.
    //
    // Both halves of that opt-out needed upstream fixes and now have them:
    // stacksjs/stx#1813 made an explicit null from config survive (useColorMode's
    // pick() used to read a boot-global null as "unspecified" and fall through to
    // 'dark'), and #1812 stood down the second, older pre-paint theme guard that
    // used to put class="dark" on <html> unconditionally from a storage key
    // nothing here writes. Verified: no class is managed and no guard is emitted.
    colorMode: {
      storageKey: 'bughq_theme',
      attribute: 'data-theme',
      darkClass: null,
      initialMode: 'auto',
    },

    head: {
      title: 'bughq',

      // Everything below was copy-pasted into individual pages: the font links
      // into 34 of them, the theme guard into 11. injectConfigHeadTags dedupes
      // on href and on inline script content (document-shell.js:74-92), so
      // declaring them here is safe while the inline copies still exist — they
      // can be removed a page at a time rather than in one commit.
      //
      // NOT here: charset and viewport. generateDocumentShell hardcodes both
      // ahead of any config meta (document-shell.js:26-29), so declaring them
      // would emit a second copy on every fragment page. Measured: /dashboard
      // rendered `<meta charset="UTF-8">` and `<meta charset="utf-8">` back to
      // back. The doctype pages carry their own until Stage 2 moves them into
      // the layout.
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        // The weight sets had drifted across pages: 26 asked for JetBrains Mono
        // 400;500;600, 7 for 400;500, and one page for Mono alone. This is the
        // superset, so no page loses a weight it was using.
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
        },
      ],

      // NOT here any more: the hand-rolled pre-paint theme guard. `app.colorMode`
      // below emits that script from the framework instead, off the same option
      // surface useColorMode reads — so the boot script and the composable
      // cannot disagree about the storage key or the attribute.

      // NOT here: /marketing.css. The remediation plan called for it, but it
      // defines :root, html, body, * and a — and four classes the app pages
      // also use: .btn (24 uses), .panel (17), .mono, .reveal. Globalising it
      // would restyle the authenticated app. It stays per-page until Stage 2
      // gives marketing its own layout, which is its correct home.
    },
  },
} satisfies UiOptions
