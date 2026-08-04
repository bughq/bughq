/**
 * Light/dark mode.
 *
 * Four pages each carried their own copy of this: an `effectiveTheme()` that
 * read the attribute off the root element with a `prefers-color-scheme`
 * fallback, a `theme` signal, and a `toggleTheme()` that wrote the attribute,
 * wrote localStorage, and set the signal — three things to keep in step,
 * duplicated four times.
 *
 * `useColorMode` does all of it, and takes its configuration from
 * `window.__STX_COLOR_MODE__`, which the pre-paint boot script publishes from
 * `app.colorMode` in config/ui.ts. That shared source is the point: without it
 * the composable would fall back to its own defaults, read a different storage
 * key, and undo the theme on hydration — reintroducing the exact flash the boot
 * script exists to prevent (stacksjs/stx#1794).
 *
 * So this store passes NO options, deliberately. The configuration lives in one
 * place and both readers take it from there.
 */

// Store files get no auto-imports: store-loader.js:50-68 strips every import,
// transpiles, and wraps the file in a bare IIFE with no destructuring prelude,
// unlike a .stx client block. Only true globals are visible, so the composables
// come off window.stx explicitly. Same reason as stores/session.ts.
const { useColorMode, state, onDestroy } = window.stx

export const useTheme = defineStore('theme', () => {
  // Returns getters plus set()/subscribe() — NOT a signal and NOT a ref. There
  // is no `.value`: it is `cm.mode` to read and `cm.set(x)` to write. A template
  // binding cannot react to a getter, which is why the signal below exists.
  //
  // The options are passed explicitly, duplicating app.colorMode in config/ui.ts,
  // and that duplication is a WORKAROUND for stacksjs/stx#1803 — not a preference.
  // useColorMode reads its config from window.__STX_COLOR_MODE__, which the
  // pre-paint boot script publishes, but that script is emitted AFTER the store
  // bundle. So at the moment this runs the global does not exist yet and the
  // composable silently falls back to its own defaults: storageKey
  // 'stx-color-mode' and attribute null. Measured — a toggle wrote 'light' to
  // 'stx-color-mode' and never touched data-theme, so the theme appeared dead and
  // the user's preference landed somewhere the boot script never reads.
  //
  // When #1803 is fixed (boot script emitted first in <head>), delete these
  // options and let the config be the single source again.
  const cm = useColorMode({
    storageKey: 'bughq_theme',
    attribute: 'data-theme',
    darkClass: null,
    initialMode: 'auto',
  })

  /** The resolved mode, mirrored into a signal so `:data-t="theme()"` re-renders. */
  const theme = state(cm.mode)

  // One-way mirror. The composable stays the source of truth for storage and for
  // the attribute on the root element; the signal only exists so the template can
  // observe it. subscribe() also fires on cross-tab storage changes, so a theme
  // switched in another tab updates this one's icon.
  const stop = cm.subscribe(() => theme.set(cm.mode))
  onDestroy(stop)

  function toggle(): void {
    cm.set(cm.mode === 'dark' ? 'light' : 'dark')
    theme.set(cm.mode)
  }

  /** True when the resolved mode is dark — for an icon that has two states. */
  function isDark(): boolean {
    return theme() === 'dark'
  }

  return { theme, toggle, isDark }
})
