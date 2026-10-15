/**
 * Crosswind (utility CSS) config.
 *
 * The palette is registered here as semantic color tokens backed by CSS custom
 * properties (`--bg`, `--panel`, `--border`, `--text*`, `--accent`). That gives
 * real utilities (`bg-panel`, `text-subtle`, `border-line`, `text-accent`)
 * instead of inline `style="color: var(--…)"`, while the vars still swap under
 * `[data-theme]` / `prefers-color-scheme` so dark mode keeps working without a
 * `dark:` on every class.
 *
 * The custom properties themselves are defined below in `preflights`, and used
 * to be defined per-page: a 13-line `:root` block copy-pasted into nine views,
 * byte-identical in seven of them. Two had quietly drifted — dashboard.stx
 * carried a `--mono` stack with SFMono-Regular and Menlo fallbacks that the
 * other eight lacked, which is the drift this arrangement exists to prevent.
 *
 * @see https://github.com/cwcss/crosswind
 */

/** One theme's worth of custom properties. Both modes must supply every key. */
interface Palette {
  /** Page background. */
  bg: string
  /** Raised surface — cards, panels, inputs. */
  panel: string
  /** Hairline borders and dividers. */
  border: string
  /** Primary text. */
  text: string
  /** Secondary text — labels, captions. */
  text2: string
  /** Tertiary text — placeholders, timestamps. */
  text3: string
  /** Brand accent, used for primary actions and focus rings. */
  accent: string
  /** Text placed on the brand accent. */
  accentInk: string
  /** Sparkline / activity rail tint on the dashboard. */
  rail: string
  /** Success state. */
  ok: string
  /** Error and destructive state. */
  warn: string
  /** Discord brand colour, for the integrations list in settings. */
  discord: string

  /*
   * The six /issue/:id declared for itself, in its own `:root`. They are not
   * page-specific values, they were a page-specific DECLARATION SITE -- which
   * is the thing §11.2 forbids. pageCss() already reads --panel-2 and
   * --border-2 for the Autofix panel's surfaces and step dividers, and that
   * worked only because the panel renders on the one page that defined them.
   */
  /** Recessed surface inside a panel: Autofix's setup strip, a frame's wash. */
  panel2: string
  /** The quieter of the two hairlines, for dividers inside a card. */
  border2: string
  /** Code text and the strip it sits on, in the stack trace. */
  code: string
  codeBg: string
  /** Application frames in a stack trace: the wash and its left bar. */
  appTint: string
  appBar: string
}

const light: Palette = {
  bg: '#fbfbfd',
  panel: '#ffffff',
  border: 'rgba(15,23,42,0.09)',
  text: '#0b0f19',
  text2: '#4b5565',
  text3: '#667085',
  accent: '#e11d48',
  accentInk: '#ffffff',
  rail: 'rgba(225,29,72,0.14)',
  ok: '#16a34a',
  warn: '#b91c1c',
  discord: '#5865f2',
  panel2: '#fbfcfd',
  border2: 'rgba(15,23,42,0.06)',
  code: '#0f172a',
  codeBg: '#f8fafc',
  appTint: 'rgba(225,29,72,0.07)',
  appBar: '#e11d48',
}

const dark: Palette = {
  bg: '#090b11',
  panel: '#10131c',
  border: 'rgba(148,163,184,0.12)',
  text: '#f3f5f9',
  text2: '#b3bccb',
  text3: '#7b879a',
  accent: '#fb7185',
  accentInk: '#090b11',
  rail: 'rgba(251,113,133,0.16)',
  ok: '#4ade80',
  warn: '#f87171',
  discord: '#818cf8',
  panel2: '#0e111a',
  border2: 'rgba(148,163,184,0.08)',
  code: '#e5e9f0',
  codeBg: '#0b0e16',
  appTint: 'rgba(251,113,133,0.1)',
  appBar: '#fb7185',
}

/**
 * Mode-independent values. Slack's brand colour does not change between themes,
 * and the two font stacks are the same strings crosswind's `fontFamily` above
 * resolves `font-sans` / `font-mono` to — declared here as well because plain
 * CSS in the views selects them via `var(--sans)` / `var(--mono)`.
 */
const constants = [
  `--slack: #611f69`,
  /*
   * /issue/:id's system stack, as a token rather than a literal.
   *
   * Not a style choice. This engine REWRITES a `font-family` in a preflight
   * when the rule is written in the SPACED form -- `sel { prop: value; }` --
   * and the stack begins with `ui-sans-serif`. It substitutes the theme's own
   * `fontFamily.sans`, or its default `ui-sans-serif, system-ui, sans-serif`
   * when none is configured. Measured on the installed engine:
   *
   *   body { font-family: ui-sans-serif, -apple-system, 'Segoe UI', sans-serif; }
   *     -> font-family: Space Grotesk, ui-sans-serif, system-ui, sans-serif
   *   body{font-family:ui-sans-serif, -apple-system, 'Segoe UI', sans-serif}
   *     -> unchanged
   *
   * Quoting has nothing to do with it: unquoted, single- and double-quoted all
   * behave the same. A stack that does not start with `ui-sans-serif` is left
   * alone (`Georgia, sans-serif`, `'Iowan Old Style', Georgia, serif`,
   * `'JetBrains Mono', ui-monospace, monospace` all survive), and so is
   * anything behind `var()` or declared as a custom property. No neighbouring
   * rule is lost either way.
   *
   * Every rule in this file is written spaced, so `var()` is the fix here. It
   * is also the only one that does not depend on remembering the above.
   */
  `--sans-system: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`,
  `--sans: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif`,
  `--mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`,
].join('; ')

function declarations(p: Palette): string {
  return [
    `--bg: ${p.bg}`,
    `--panel: ${p.panel}`,
    `--border: ${p.border}`,
    `--text: ${p.text}`,
    `--text-2: ${p.text2}`,
    `--text-3: ${p.text3}`,
    `--accent: ${p.accent}`,
    `--accent-ink: ${p.accentInk}`,
    `--rail: ${p.rail}`,
    `--ok: ${p.ok}`,
    `--warn: ${p.warn}`,
    `--discord: ${p.discord}`,
    `--panel-2: ${p.panel2}`,
    `--border-2: ${p.border2}`,
    `--code: ${p.code}`,
    `--code-bg: ${p.codeBg}`,
    `--app-tint: ${p.appTint}`,
    `--app-bar: ${p.appBar}`,
  ].join('; ')
}

/**
 * Light is the base. The system-preference block then dark-mode's anyone who has
 * expressed no explicit choice, and the two `[data-theme]` rules let the toggle
 * (and the pre-paint boot script in config/ui.ts, which writes that attribute)
 * override the system in either direction.
 *
 * Order matters: `[data-theme]` must come after the media query so an explicit
 * choice wins over the OS preference.
 */
function paletteCss(): string {
  return [
    `:root { ${declarations(light)}; ${constants}; }`,
    `@media (prefers-color-scheme: dark) { :root { ${declarations(dark)}; } }`,
    `:root[data-theme="dark"] { ${declarations(dark)}; }`,
    `:root[data-theme="light"] { ${declarations(light)}; }`,
    // Eleven views declared this identically but for one: issue/[id].stx uses a
    // system font stack instead of var(--sans), and keeps that as a local rule.
    //
    // An element selector, so it belongs here and not in `shortcuts` — there is
    // no class to attach. Being in a preflight also puts it in the @layer
    // cw-base cascade layer, where an unlayered utility beats it regardless of
    // specificity. That is the right way round for `body`: a page or a utility
    // that sets its own background should win, and nothing here competes.
    `body { background: var(--bg); color: var(--text); font-family: var(--sans); -webkit-font-smoothing: antialiased; }`,

    /*
     * /issue/:id sets a system stack instead of --sans, and has since it was
     * written. Nothing anywhere records why, so this preserves it rather than
     * deciding for it: unifying onto Space Grotesk like every other page is a
     * visible change to the one surface people read long technical text on,
     * and it is a one-line deletion here whenever someone wants to make it.
     *
     * Keyed off a class on the page's outermost element, because the layout
     * group meta cannot tell /issue/:id from /dashboard -- both are `default`.
     * `:has()` is live and that div's start tag is parsed before any of its
     * content, so the family is settled before the first glyph paints, which a
     * hook further down the page (the `.bughq-cols` grid, say) would not do.
     */
    `body:has(.issue-root) { font-family: var(--sans-system); }`,
  ].join('\n')
}

/**
 * Page-level rules that genuinely cannot be utilities, hoisted out of per-page
 * `<style>` blocks (stx-standards rule 3, §11.1).
 *
 * Why this is not cosmetic. The SPA router only manages `style[data-crosswind]`
 * and `style[data-stx-page]`; an unmarked `<style>` rendered into the head by
 * the entry page is never removed (`stx-router/dist/client.js:418`). Verified in
 * the browser: entering on /pricing and navigating to / left pricing's own
 * 665-char block live, and a `.card` element on the home page picked up
 * pricing's `var(--surface)` background. Rules that live here land inside the
 * single `style[data-crosswind]` tag instead, which the router treats as
 * durable, so they apply deliberately everywhere rather than accidentally
 * wherever the visitor happened to enter.
 *
 * Only put a rule here when it cannot be expressed as a utility or a shortcut.
 * A structural selector qualifies; a bag of properties on one class does not,
 * that is a `shortcuts` entry.
 */
/*
 * The marketing surface, scoped to its layout group.
 *
 * From public/marketing.css, linked by resources/views/layouts/marketing.stx
 * alone -- never site-wide, because this sheet gives `.btn`, `.panel` and
 * `.shell` meanings the app pages contradict. That is also why it cannot be an
 * unscoped preflight: a preflight reaches every page. It carries the layout
 * group instead, which stx emits into <head> from the layout's filename.
 * Measured on the served app: /, /pricing, /compare, /docs and /use-cases
 * report `marketing`; /login and /dashboard report `default`.
 *
 * THIS FILE'S OWN DECISIONS THAT DEPENDED ON IT BEING UNLAYERED
 *
 * Two comments below were written because marketing.css was an unlayered
 * stylesheet and a preflight lands in @layer tc-base. Neither breaks, because
 * both remedies stay unlayered and so still win, but both reasons are now
 * stale and are corrected where they sit:
 *
 *   `cmp-hl`   a shortcut rather than a preflight rule, to beat
 *              `.cmp-cell { background: var(--surface) }` here. Shortcuts
 *              compile to unlayered utilities, so it still wins.
 *   `.hero-code .code-bar`  kept OUT of pageCss because it would have lost to
 *              this file's `.code-bar`. Its two differing numbers are
 *              utilities on the element, and utilities are unlayered too.
 *
 * WHAT WAS DROPPED
 *
 * Six tokens -- --bg, --border, --mono, --text, --text-2 and --text-3 --
 * resolve to the same values as paletteCss, so marketing pages inherit them.
 * --border differed only by whitespace inside rgba() and --mono only by quote
 * character; neither distinction exists in CSS. 57 declarations to 36.
 *
 * What stays is what genuinely differs, and it is more than loghq had:
 * --accent is #d31340 here against the app's #e11d48, --accent-ink #1a0509
 * against #090b11, and --code-bg is a DARK surface (#0b0f19 / #05070c) where
 * the app's is light (#f8fafc / #0b0e16). Plus the marketing-only
 * --surface, --surface-2, --border-strong, --accent-soft, --accent-line,
 * --code-ink, --r and --r-sm, and --sans, which carries `-apple-system`.
 *
 * `@keyframes reveal` is GONE rather than moved. An @keyframes cannot be
 * nested inside a style rule -- only conditional at-rules can -- so it could
 * not travel into the block, and it did not need to: pageCss already declares
 * `@keyframes reveal { to { opacity: 1; transform: none; } }` byte-identical,
 * unscoped, so it reaches these pages anyway. The `.reveal` RULE differs
 * (12px/0.6s here against 10px/0.5s there) and stays, winning on marketing
 * pages by both specificity and order.
 *
 * WHAT HAD TO BE SPELLED OUT
 *
 * Nesting puts the prefix in front of a descendant, so a rule rooted AT or
 * ABOVE <html> cannot nest -- `html:has(...) html` matches nothing, and :root
 * IS html. The four theme blocks, the `html` rule and `*` are written out;
 * `*` becomes `P, P *` because it matched html itself. `body` nests fine and
 * is written out only to keep the document-level rules together.
 */
const MARKETING = `
html:has(meta[name="stx-layout-group"][content="marketing"]) {
  --surface: #ffffff;
  --surface-2: #f4f5f8;
  --border-strong: rgba(15, 23, 42, 0.16);
  --accent: #d31340;
  --accent-ink: #ffffff;
  --accent-soft: rgba(225, 29, 72, 0.08);
  --accent-line: rgba(225, 29, 72, 0.34);
  --code-bg: #0b0f19;
  --code-ink: #d6deeb;
  --r: 14px;
  --r-sm: 9px;
  --sans: "Space Grotesk", ui-sans-serif, system-ui, -apple-system, sans-serif;
}

@media (prefers-color-scheme: dark) {
  html:has(meta[name="stx-layout-group"][content="marketing"]) {
    --surface: #10131c; --surface-2: #161a24;
    --border-strong: rgba(148, 163, 184, 0.2);
    --accent: #fb7185; --accent-ink: #1a0509;
    --accent-soft: rgba(251, 113, 133, 0.1); --accent-line: rgba(251, 113, 133, 0.32);
    --code-bg: #05070c;
  }
}
html:has(meta[name="stx-layout-group"][content="marketing"])[data-theme="dark"] {
  --surface: #10131c; --surface-2: #161a24;
  --border-strong: rgba(148, 163, 184, 0.2);
  --accent: #fb7185; --accent-ink: #1a0509;
  --accent-soft: rgba(251, 113, 133, 0.1); --accent-line: rgba(251, 113, 133, 0.32);
  --code-bg: #05070c;
}
html:has(meta[name="stx-layout-group"][content="marketing"])[data-theme="light"] {
  --surface: #ffffff; --surface-2: #f4f5f8;
  --border-strong: rgba(15, 23, 42, 0.16);
  --accent: #d31340; --accent-ink: #ffffff;
  --accent-soft: rgba(225, 29, 72, 0.08); --accent-line: rgba(225, 29, 72, 0.34);
  --code-bg: #0b0f19;
}

html:has(meta[name="stx-layout-group"][content="marketing"]), html:has(meta[name="stx-layout-group"][content="marketing"]) * { box-sizing: border-box; }
html:has(meta[name="stx-layout-group"][content="marketing"]) { background: var(--bg); scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
html:has(meta[name="stx-layout-group"][content="marketing"]) body {
  margin: 0; min-height: 100vh; overflow-x: hidden;
  color: var(--text); background: var(--bg);
  font-family: var(--sans); font-size: 16px; line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

html:has(meta[name="stx-layout-group"][content="marketing"]) {
a { color: inherit; text-decoration: none; }

.shell { width: min(1180px, calc(100% - 48px)); margin: 0 auto; }
.shell-narrow { width: min(920px, calc(100% - 48px)); margin: 0 auto; }
.mono { font-family: var(--mono); }

/* nav */
.nav {
  position: sticky; top: 0; z-index: 30;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
}
.nav-inner { display: flex; align-items: center; justify-content: space-between; gap: 1.25rem; min-height: 68px; }
.brand { display: inline-flex; align-items: center; gap: 0.6rem; }
.brand-mark {
  display: grid; place-items: center; width: 30px; height: 30px;
  border: 1px solid var(--accent-line); border-radius: var(--r-sm);
  color: var(--accent); font-weight: 700; font-size: 1rem; line-height: 1;
}
.brand-name { font-weight: 700; font-size: 1.12rem; letter-spacing: -0.02em; }
.nav-links { display: flex; align-items: center; gap: 1.6rem; margin-left: auto; color: var(--text-2); font-size: 0.9rem; }
.nav-links a { transition: color 0.16s ease; }
.nav-links a:hover { color: var(--text); }
.nav-cta { margin-left: 1.6rem; }

.nav-menu { display: none; margin-left: auto; position: relative; }
.nav-menu > summary {
  list-style: none; display: grid; place-items: center; width: 40px; height: 40px;
  border: 1px solid var(--border-strong); border-radius: var(--r-sm); cursor: pointer;
}
.nav-menu > summary::-webkit-details-marker { display: none; }
.nav-menu > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.burger, .burger::before, .burger::after {
  display: block; width: 18px; height: 1.5px; background: var(--text);
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.burger { position: relative; }
.burger::before { content: ""; position: absolute; top: -5px; }
.burger::after { content: ""; position: absolute; top: 5px; }
.nav-menu[open] .burger { background: transparent; }
.nav-menu[open] .burger::before { transform: translateY(5px) rotate(45deg); }
.nav-menu[open] .burger::after { transform: translateY(-5px) rotate(-45deg); }
.nav-menu-panel {
  position: absolute; right: 0; top: calc(100% + 12px); z-index: 50;
  display: flex; flex-direction: column; gap: 0.25rem; min-width: 232px; padding: 0.6rem;
  max-height: calc(100dvh - 92px); overflow-y: auto; overscroll-behavior: contain;
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--r);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
}
.nav-menu-panel a { padding: 0.6rem 0.7rem; border-radius: var(--r-sm); color: var(--text-2); font-size: 0.95rem; }
.nav-menu-panel a:hover { color: var(--text); background: var(--surface-2); }
.nav-menu-panel .btn { margin-top: 0.35rem; justify-content: center; }

/* buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  min-height: 46px; padding: 0 1.15rem; border: 1px solid var(--border-strong); border-radius: var(--r-sm);
  color: var(--text); font-family: var(--sans); font-weight: 600; font-size: 0.92rem;
  white-space: nowrap; background: transparent; cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}
.btn.sm { min-height: 38px; padding: 0 0.85rem; font-size: 0.86rem; }
.btn.primary { border-color: var(--accent); color: var(--accent-ink); background: var(--accent); }
.btn.primary:hover { background: color-mix(in srgb, var(--accent) 88%, #000); }
.btn.ghost:hover { border-color: var(--accent-line); }
.btn:active { transform: translateY(1px); }

/* section scaffolding */
.section { padding: 3.5rem 0; }
.section-head { max-width: 62ch; margin-bottom: 1.75rem; }
.section-title { margin: 0; font-weight: 700; font-size: clamp(1.6rem, 3.5vw, 2.2rem); letter-spacing: -0.03em; line-height: 1.1; }
.section-intro { margin: 0.9rem 0 0; color: var(--text-2); font-size: 1.02rem; line-height: 1.6; }
.eyebrow { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
.textlink { color: var(--accent); font-weight: 500; }
.textlink:hover { text-decoration: underline; }

/* hero */
.hero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 3.5rem; align-items: center; padding: 3.5rem 0 4rem; }
.hero-title { margin: 0; font-weight: 700; font-size: clamp(2.3rem, 5.4vw, 3.4rem); letter-spacing: -0.035em; line-height: 1.04; }
.hero-sub { margin: 1.25rem 0 0; color: var(--text-2); font-size: 1.08rem; line-height: 1.6; max-width: 54ch; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 2rem; }

/* single-column feature/use-case hero */
.feat-hero { padding: 2.5rem 0 1.5rem; max-width: 62ch; }
.feat-hero .kicker { display: inline-flex; align-items: center; gap: 0.5rem; font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
.feat-hero h1 { margin: 1rem 0 0; font-weight: 700; font-size: clamp(2.1rem, 5vw, 3.1rem); line-height: 1.05; letter-spacing: -0.03em; }
.feat-hero p { margin: 1.1rem 0 0; color: var(--text-2); font-size: 1.05rem; line-height: 1.6; }
.feat-hero .hero-actions { margin-top: 1.75rem; }

.subnav { display: flex; align-items: center; gap: 0.5rem; padding-top: 1.75rem; color: var(--text-3); font-size: 0.88rem; }
.subnav a { color: var(--text-2); transition: color 0.16s ease; }
.subnav a:hover { color: var(--text); }
.subnav .sep { color: var(--text-3); }

/* code panel */
.code { background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; }
.code-bar { display: flex; align-items: center; gap: 0.6rem; padding: 0.75rem 1rem; border-bottom: 1px solid rgba(148,163,184,0.14); }
.code-body { margin: 0; padding: 1.1rem 1.25rem; overflow-x: auto; font-family: var(--mono); font-size: 12.5px; line-height: 1.65; color: var(--code-ink); }
.chart-cap { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: #8a94a6; }

/* panel (data viz container) */
.panel { border: 1px solid var(--border); border-radius: var(--r); background: var(--surface); padding: 1.4rem 1.5rem; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
.panel-tag { font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
.live { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-2); }
.live-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.stat-big { margin: 0; font-weight: 700; font-size: 2.6rem; letter-spacing: -0.03em; }
.stat-label { margin: 0.15rem 0 0; color: var(--text-3); font-size: 0.9rem; }

/* trackless bars */
.bar-row { display: grid; grid-template-columns: 148px 1fr 52px; align-items: center; gap: 0.9rem; padding: 0.5rem 0; }
.bar-row + .bar-row { border-top: 1px solid var(--border); }
.bar-label { color: var(--text-2); font-size: 0.88rem; }
.bar-track { height: 8px; border-radius: 999px; background: transparent; }
.bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--accent); opacity: 0.82; min-width: 4px; }
.bar-value { font-family: var(--mono); font-size: 0.82rem; color: var(--text); text-align: right; }

/* stat/severity tiles */
.vitals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; }
.vital { padding: 1.4rem 1.5rem; background: var(--surface); }
.vital-k { font-family: var(--mono); font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-3); }
.vital-v { margin-top: 0.5rem; font-weight: 700; font-size: 1.9rem; letter-spacing: -0.02em; color: var(--text); }
.vital-tag { margin-top: 0.4rem; display: inline-flex; font-size: 0.78rem; color: var(--accent); }

/* numbered flow */
.flow { display: grid; gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; }
.flow-step { display: grid; grid-template-columns: auto 1fr; gap: 1.1rem; padding: 1.4rem 1.5rem; background: var(--surface); }
.flow-num { font-family: var(--mono); font-size: 0.82rem; color: var(--accent); padding-top: 0.15rem; }
.flow-step h3 { margin: 0; font-weight: 600; font-size: 1.05rem; letter-spacing: -0.01em; }
.flow-step p { margin: 0.4rem 0 0; color: var(--text-2); font-size: 0.95rem; line-height: 1.55; }

/* metric tiles */
.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem 2.5rem; }
.metric .m-value { font-weight: 700; font-size: clamp(1.8rem, 4vw, 2.4rem); letter-spacing: -0.02em; color: var(--text); }
.metric .m-label { margin-top: 0.35rem; color: var(--text-2); font-size: 0.9rem; line-height: 1.5; }

/* chips grid */
.chips { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
.chip { border: 1px solid var(--border); border-radius: var(--r); padding: 1.4rem 1.5rem; background: var(--surface); }
.chip h3 { margin: 0; font-weight: 600; font-size: 1.05rem; letter-spacing: -0.01em; }
.chip p { margin: 0.5rem 0 0; color: var(--text-2); font-size: 0.94rem; line-height: 1.6; }

/* feature bento (landing) */
.bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; }
.cell { display: block; padding: 1.5rem 1.6rem; background: var(--surface); transition: background 0.16s ease; }
a.cell { cursor: pointer; }
a.cell:hover { background: var(--surface-2); }
.cell h3 { margin: 0; font-weight: 600; font-size: 1.08rem; letter-spacing: -0.015em; }
.cell p { margin: 0.5rem 0 0; color: var(--text-2); font-size: 0.93rem; line-height: 1.55; }
.cell.lead { grid-column: span 1; }
.cell.tint { background: var(--accent-soft); }
a.cell.tint:hover { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); }
.cell-more { display: inline-flex; align-items: center; gap: 0.35rem; margin-top: 1rem; font-family: var(--mono); font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-2); transition: color 0.16s ease, gap 0.16s ease; }
.cell-more::after { content: "\\2192"; }
a.cell:hover .cell-more { color: var(--accent); gap: 0.55rem; }

/* comparison table */
.cmp { display: grid; grid-template-columns: 1.1fr 1fr 1fr; border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; }
.cmp-cell { padding: 1rem 1.2rem; border-top: 1px solid var(--border); background: var(--surface); font-size: 0.92rem; }
.cmp-cell:nth-child(-n+3) { border-top: none; font-weight: 600; }
.cmp-dim { color: var(--text-3); }
.cmp-ghost { color: var(--text); }

/* related features */
.related { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; }
.related a { display: block; padding: 1.3rem 1.4rem; background: var(--surface); transition: background 0.16s ease; }
.related a:hover { background: var(--surface-2); }
.related .r-name { font-weight: 600; font-size: 1rem; color: var(--text); letter-spacing: -0.01em; }
.related .r-desc { margin-top: 0.3rem; color: var(--text-3); font-size: 0.86rem; line-height: 1.45; }

/* use-case cards */
.usecases { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
.usecase { border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; background: var(--surface); }
.usecase img { display: block; width: 100%; height: 168px; object-fit: cover; }
.usecase-body { padding: 1.4rem 1.5rem 1.6rem; }
/* h2, not h3: these card titles are the only headings under the page h1,
   so h3 skipped a level. The element selector follows the markup. */
.usecase-body h2 { margin: 0; font-weight: 700; font-size: 1.15rem; letter-spacing: -0.02em; }
.usecase-body p { margin: 0.55rem 0 0; color: var(--text-2); font-size: 0.94rem; line-height: 1.6; }
.usecase-body .textlink { margin-top: 0.9rem; display: inline-block; }

/* cta band */
.cta-band { border: 1px solid var(--border); border-radius: var(--r); padding: 2.5rem; background: var(--surface); text-align: center; }
.cta-band h2 { margin: 0 auto; max-width: 30ch; font-weight: 700; font-size: clamp(1.5rem, 3.5vw, 2rem); letter-spacing: -0.03em; }
.cta-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; margin-top: 1.5rem; }

/* footer */
.footer { padding: 2.5rem 0; }
.footer-bottom { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-top: 1.5rem; border-top: 1px solid var(--border); color: var(--text-3); font-size: 0.88rem; }

/* motion */
.reveal { opacity: 0; transform: translateY(12px); animation: reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
@media (prefers-reduced-motion: reduce) { .reveal { animation: none; opacity: 1; transform: none; } }

/* responsive */
@media (max-width: 900px) {
  body:has(.nav-menu[open]) { overflow: hidden; }
  .hero { grid-template-columns: 1fr; gap: 2rem; padding-top: 2.5rem; }
  .bento, .related, .cmp { grid-template-columns: 1fr; }
  .metrics { grid-template-columns: 1fr 1fr; }
  .chips, .usecases { grid-template-columns: 1fr; }
  .nav-links { display: none; }
  .nav-cta { display: none; }
  .nav-menu { display: block; }
}
@media (max-width: 560px) {
  .metrics, .vitals { grid-template-columns: 1fr; }
  .flow-step { grid-template-columns: 1fr; gap: 0.4rem; }
  .bar-row { grid-template-columns: 120px 1fr 44px; }
}

/* login link beside the Sign up nav button */
.nav-login { color: var(--text-2); font-size: 0.9rem; transition: color 0.16s ease; }
.nav-login:hover { color: var(--text); }
.nav-cta { margin-left: 0.95rem; }
}
`

function pageCss(): string {
  return [
    // The /compare/* tables, which declared this identically in eight pages.
    //
    // Only `.cmp-note` lives here. The column highlight is a `cmp-hl` shortcut
    // instead, because it has to beat `.cmp-cell { background: var(--surface) }`
    // in the MARKETING block above. That rule was in public/marketing.css, an
    // unlayered stylesheet, when this was written: a preflight lands in
    // `@layer tc-base` and an unlayered rule wins over a layered one whatever
    // the specificity, so as a preflight the highlight silently stopped
    // applying. Both are layered now, but the shortcut still wins -- shortcuts
    // compile to unlayered utilities -- so this stays as it is. Nothing
    // competes with `.cmp-note`, so it is fine here.
    '.cmp-note { margin-top: 1rem; color: var(--text-3); font-size: 0.86rem; line-height: 1.55; max-width: 68ch; }',

    // components/AutofixPanel.stx. Every selector here is `.autofix-*`, unique to
    // this component, so nothing competes and the layer does not matter. The four
    // rules that reach a `.btn` stayed in the component: issue/[id].stx, the only
    // page that renders it, declares its own unlayered `.btn` with !important.
    `
.autofix-hidden { display:none !important; }
/* AI Autofix */
.autofix-card { width:100%; min-width:0; overflow:hidden; background:var(--panel); border:1px solid var(--border); border-radius:14px; }
.autofix-top { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 1.1rem; border-bottom:1px solid var(--border-2); }
.autofix-title { display:flex; align-items:center; gap:.65rem; font-weight:700; letter-spacing:-.015em; }
.autofix-title i { color:var(--accent); }
.autofix-status { font-family:var(--mono); font-size:.7rem; color:var(--text-3); }
.autofix-setup { padding:1rem 1.1rem 1.15rem; background:var(--panel-2); }
.autofix-fields { display:grid; grid-template-columns:minmax(0,1fr) minmax(9rem,.35fr) auto; gap:.65rem; align-items:end; }
.autofix-field label { display:block; margin-bottom:.35rem; color:var(--text-3); font-size:.7rem; font-weight:600; }
.autofix-input { width:100%; border:1px solid var(--border); border-radius:9px; background:var(--panel); color:var(--text); padding:.55rem .7rem; font-family:var(--mono); font-size:.76rem; outline:none; }
.autofix-input:focus { border-color:color-mix(in srgb,var(--accent) 65%,var(--border)); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent); }
.autofix-run { padding:1.1rem; }
.autofix-progress { height:3px; overflow:hidden; background:var(--border); }
.autofix-progress span { display:block; height:100%; background:var(--accent); transition:transform .35s ease; transform-origin:left; }
.autofix-step { border-top:1px solid var(--border-2); }
.autofix-step summary { display:flex; align-items:center; gap:.75rem; padding:.9rem 1rem; cursor:pointer; list-style:none; }
.autofix-step summary::-webkit-details-marker { display:none; }
.autofix-step summary:hover { background:var(--panel-2); }
.autofix-step .step-icon { width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:var(--panel-2); color:var(--text-3); }
.autofix-step.done .step-icon, .autofix-step.active .step-icon { color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,transparent); }
.autofix-step .step-copy { flex:1; min-width:0; }
.autofix-step .step-name { font-size:.83rem; font-weight:650; }
.autofix-step .step-state { margin-top:.1rem; color:var(--text-3); font-size:.7rem; }
.autofix-step .step-chevron { color:var(--text-3); transition:transform .16s ease; }
.autofix-step[open] .step-chevron { transform:rotate(90deg); }
.autofix-detail { padding:.1rem 1rem 1rem 3.75rem; color:var(--text-2); font-size:.8rem; line-height:1.55; }
.autofix-plan { display:grid; gap:.55rem; }
.autofix-plan li { display:grid; grid-template-columns:1.15rem 1fr; gap:.55rem; }
.autofix-file { padding:.6rem .7rem; border-radius:9px; background:var(--panel-2); }
.autofix-file + .autofix-file { margin-top:.45rem; }
.autofix-error { margin:0 1rem 1rem; padding:.7rem .8rem; border-radius:9px; color:#ef4444; background:rgba(239,68,68,.08); font-size:.78rem; }
.autofix-value { color:var(--text-2); line-height:1.55; white-space:pre-wrap; }
.autofix-value::after { content:attr(data-value); }
.autofix-skeleton { height:.75rem; border-radius:5px; background:linear-gradient(90deg,var(--border),var(--panel-2),var(--border)); background-size:200% 100%; animation:autofix-shimmer 1.4s ease infinite; }
@keyframes autofix-shimmer { to { background-position:-200% 0; } }
@media (prefers-reduced-motion: reduce) { .autofix-progress span { transition:none; } .autofix-skeleton { animation:none; } }
@media (max-width:767px) { .autofix-fields { grid-template-columns:1fr; } .autofix-detail { padding-left:1rem; } .autofix-top { align-items:flex-start; } }
    `,

    // The auth flow: login, register, forgot-password, reset-password and
    // projects/new. All five declared `.field:focus` and `.err` identically, and
    // login and register declared `.divider` identically too.
    //
    // Two pages outside this set declare the same names differently and KEEP
    // their own scoped blocks for now, so both had to be made explicit rather
    // than left to the cascade: settings.stx's `.field:focus` sets no
    // box-shadow and pricing.stx's `.err` sets no background, and without
    // saying so they would have inherited those from here. Each now states the
    // absence. Remove those two declarations when those files are hoisted and
    // the family can be reconciled properly.
    `
    .err { background: color-mix(in srgb, #ef4444 12%, transparent); color: #ef4444; }
    .divider { display: flex; align-items: center; gap: 0.75rem; color: var(--text-3); font-size: 12px; }
    .divider::before, .divider::after { content: ""; height: 1px; flex: 1; background: var(--border); }
    /* Was a 5-property cssText string assigned to a createElement'd <p>. */
    .invite-hint { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); }
    input[readonly].field { opacity: 0.85; }
    .ok { background: color-mix(in srgb, #22c55e 12%, transparent); color: #16a34a; }
    .limit-note { border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-2); margin-bottom: 0.75rem; }
    `,

    // views/index.stx: the hero code frame and the open-source band.
    //
    // `.hero-code .code-bar` is NOT here. It differed from the marketing
    // sheet's `.code-bar` only in gap (0.55 vs 0.6rem) and padding (0.8 vs
    // 0.75rem), and that sheet was unlayered when this was written, so as a
    // preflight it would have lost and the hero would have silently taken the
    // marketing values. Those two numbers are utilities on the element now,
    // and utilities are unlayered, so they still win; the rest of the rule,
    // which was identical, is gone.
    `
      .hero-code { border: 1px solid var(--border); border-radius: var(--r); background: var(--code-bg); overflow: hidden; }
      .hero-code .dot { width: 9px; height: 9px; border-radius: 999px; background: var(--accent); }
      .open-band { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.25rem; border: 1px solid var(--border); border-radius: var(--r); padding: 1.75rem 2rem; background: var(--surface); }
      .open-band p { margin: 0; max-width: 52ch; color: var(--text-2); font-size: 1rem; line-height: 1.55; }
      .open-band strong { color: var(--text); font-weight: 600; }
    `,

    // partials/SiteNav.stx: the CSS-only mega menu. Hover plus :focus-within on a
    // descendant, a ::after caret, and a pseudo-element hover bridge, so there is
    // nothing for a utility to attach to. No `.mega-*` name appears in
    // marketing.css, so the cascade layer does not matter here.
    `
  /* CSS-only mega menu. Reveal on hover + keyboard focus (:focus-within).
     Tokens are the same variables the rest of marketing.css uses. */
  .mega { position: relative; display: inline-flex; align-items: center; }
  .mega-trigger { display: inline-flex; align-items: center; gap: 0.32rem; cursor: pointer; }
  .mega-trigger::after {
    content: "\\25BE"; font-size: 0.62em; line-height: 1; color: var(--text-3);
    transition: transform 0.18s ease, color 0.18s ease;
  }
  .mega:hover .mega-trigger, .mega:focus-within .mega-trigger { color: var(--text); }
  .mega:hover .mega-trigger::after, .mega:focus-within .mega-trigger::after { transform: rotate(180deg); color: var(--accent); }

  .mega-panel {
    position: absolute; top: 100%; left: 50%; z-index: 50;
    margin-top: 14px;
    display: grid; grid-template-columns: repeat(2, minmax(216px, 1fr)); gap: 0.12rem;
    min-width: 484px; padding: 0.55rem;
    background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--r);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
    opacity: 0; visibility: hidden; pointer-events: none;
    transform: translateX(-50%) translateY(6px);
    transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s ease;
  }
  /* invisible hover bridge so the pointer can cross the 14px gap */
  .mega-panel::before { content: ""; position: absolute; top: -14px; left: 0; right: 0; height: 14px; }
  .mega:hover .mega-panel, .mega:focus-within .mega-panel {
    opacity: 1; visibility: visible; pointer-events: auto;
    transform: translateX(-50%) translateY(0);
  }
  .mega-panel a { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.62rem 0.72rem; border-radius: var(--r-sm); }
  .mega-panel a:hover { background: var(--surface-2); }
  .mega-t { color: var(--text); font-size: 0.9rem; font-weight: 600; letter-spacing: -0.01em; }
  .mega-d { color: var(--text-3); font-size: 0.8rem; line-height: 1.4; }

  .nav-menu-group {
    padding: 0.55rem 0.7rem 0.2rem; font-family: var(--mono); font-size: 0.68rem;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-3);
  }
  .nav-menu-group:not(:first-child) { margin-top: 0.35rem; border-top: 1px solid var(--border); }

  @media (prefers-reduced-motion: reduce) {
    .mega-trigger::after, .mega-panel { transition: none; }
  }
  @media (max-width: 900px) {
    /* desktop mega hidden with .nav-links; the <details> menu takes over */
    .mega-panel { display: none; }
  }
    `,

    // partials/SiteFooter.stx: the multi-column footer grid and its two
    // breakpoints. Same reasoning, and `.footer-*` is used nowhere else.
    `
  /* Multi-column footer. Reuses the same tokens as the rest of marketing.css. */
  .footer-cols {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr 1fr;
    gap: 2rem 2.5rem;
    padding: 1rem 0 2.25rem;
  }
  .footer-col { display: flex; flex-direction: column; gap: 0.6rem; }
  .footer-col h4 {
    margin: 0 0 0.35rem; font-family: var(--mono); font-size: 0.7rem;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-3); font-weight: 600;
  }
  .footer-col a { color: var(--text-2); font-size: 0.9rem; line-height: 1.4; transition: color 0.16s ease; }
  .footer-col a:hover { color: var(--text); }

  @media (max-width: 900px) {
    .footer-cols { grid-template-columns: 1fr 1fr; gap: 1.75rem 2rem; }
  }
  @media (max-width: 560px) {
    .footer-cols { grid-template-columns: 1fr; }
  }
    `,

    /*
     * views/dashboard.stx. The whole block, minus two rules that had to stay
     * unlayered -- see `tag-snoozed` and the switcher's hover border in
     * shortcuts and markup respectively.
     *
     * Everything here was checked for layer damage rather than assumed safe.
     * A preflight lands in @layer cw-base and an unlayered rule beats a layered
     * one at any specificity, so for each rule the question is whether another
     * class on the same element sets the same property. Two did, and both are
     * handled elsewhere; the other 62 class-bearing rules have no competitor.
     * The element-only rules -- summary, input:focus-visible,
     * textarea:focus-visible -- are uncontested too: nothing in this page
     * carries outline-none, and the summary that could clash sets neither
     * list-style nor cursor through a utility.
     *
     * The second half is the shared HQ date-range picker, the same stylesheet
     * loghq carries. Every state there is a compound selector the client script
     * toggles (.drp-day.is-range, .range-tool.is-active) and no ordinary
     * utility says "this class AND that class".
     *
     * The spelling that does, [&.is-range]:bg-accent, used to be dropped by
     * the extractor before it reached the generator. **That is fixed**
     * (ts-css#37, in 0.3.16, which this app now resolves). Measured through
     * this app's own loader and merge, against this config:
     *
     *   [&.is-range]:bg-accent          -> .….is-range { background-color: var(--accent) }
     *   [&.drp-day.is-range]:bg-accent  -> .….drp-day.is-range { … }
     *
     * So it is possible now, and the reason to keep CSS is a different one:
     * this is ONE stylesheet shared with loghq, byte for byte, and splitting
     * it into per-element utilities here would fork it. Keep it in sync rather
     * than converting it alone.
     */
    `
/* bughq - Space Grotesk display + JetBrains Mono for numerics/code.
   One accent (rose), off-black/off-white, auto light+dark, radius lock 12px. */
.mono { font-feature-settings: 'tnum' 1; }
.row-wrap { transition: background-color 0.15s ease; }
.row-wrap:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.row-link { text-decoration: none; color: inherit; }
/* The controls only materialise on hover or keyboard focus, so a list at rest
   reads as a list rather than a wall of buttons. focus-within keeps them
   reachable by tab, which display:none or opacity alone would not. */
.row-actions { opacity: 0; transition: opacity 0.12s ease; }
.row-wrap:hover .row-actions, .row-wrap:focus-within .row-actions { opacity: 1; }
@media (hover: none) { .row-actions { opacity: 1; } }
.act { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--text-3); font-size: 13px; line-height: 1; cursor: pointer; transition: color .12s ease, border-color .12s ease; }
.act:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.act:disabled { opacity: .5; cursor: default; }
.act-resolve:hover { color: #22c55e; border-color: rgba(34,197,94,.5); }
.act-ignore:hover { color: var(--text-2); }
.undo-strip { border: 1px solid var(--border); border-radius: 10px; background: var(--panel); color: var(--text-2); }
.undo-err { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); }
.undo-btn { border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 8px; background: transparent; color: var(--accent); cursor: pointer; }
.undo-btn:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.undo-x { border: 0; background: transparent; color: var(--text-3); cursor: pointer; }
.unread-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--accent); }
/* Column headers, matching the "Issues" label's weight so the row reads as one
   header rather than a title with decorations after it. */
.col-head { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
/* Icons sit at the text's own size and colour, so a number and its icon read as
   one value rather than an illustration next to a figure. */
.col-ic { width: 13px; height: 13px; color: var(--text-3); flex: none; }
.new-since { font-size: 11px; padding: 1px 6px; border-radius: 999px; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
/* Native <details> disclosure: no per-row open state to track, closes itself. */
.snooze-wrap { position: relative; }
.snooze-wrap > summary { list-style: none; display: inline-flex; align-items: center; justify-content: center; }
.snooze-wrap > summary::-webkit-details-marker { display: none; }
.snooze-menu { position: absolute; right: 0; top: 34px; z-index: 20; min-width: 116px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); box-shadow: 0 8px 24px rgb(0 0 0 / 0.18); }
.snooze-opt { display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--text-2); font-size: 12px; text-align: left; cursor: pointer; }
.snooze-opt:hover { color: var(--text); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.btn-join { padding: 0.375rem 1rem !important; font-size: 0.875rem !important; line-height: 1.25rem !important; font-weight: 600 !important; border-radius: 999px !important; background: var(--accent) !important; border: 1px solid var(--accent) !important; color: var(--accent-ink) !important; }
.pill { border-radius: 999px; transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease, transform 0.12s ease; }
/* Idle pills respond to hover; the ACTIVE tab carries inline accent styles
   which outrank these rules, so it stays put. Disabled pager pills are spans
   and never match. */
a.pill:hover, button.pill:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 6%, transparent); }
a.pill:active, button.pill:active { transform: translateY(1px); }
/* Project dropdown: replace the native select chevron (which hugged the rounded
   border) with a custom one that has a comfortable inset + room for the value. */
select.panel {
  transition: border-color 0.15s ease; cursor: pointer;
  -webkit-appearance: none; -moz-appearance: none; appearance: none;
  padding-right: 2rem; background-repeat: no-repeat;
  background-position: right 0.7rem center; background-size: 13px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2397a1b2' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
}
@media (prefers-color-scheme: dark) { select.panel { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); } }
:root[data-theme="dark"] select.panel { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); }
:root[data-theme="light"] select.panel { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2397a1b2' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); }
/* Fixed chrome (Account / Log out). These used to be built with createElement
   and positioned with an inline cssText string, which is why the position and
   typography were split from the colors. They are ordinary markup now, so the
   whole rule lives here. */
.chrome-btn { position: fixed; top: 16px; z-index: 60; padding: 8px 13px; border-radius: 9px;
  font-family: var(--sans, ui-sans-serif); font-size: 13px; line-height: 1; }
.chrome-logout { right: 18px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--border); background: var(--panel); color: var(--text-2); transition: color 0.15s ease, border-color 0.15s ease; }
.chrome-logout:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
/* Ghost, matching Log out rather than the accent fill the Upgrade pill used to
   carry. It is navigation to a settings page, not a call to action, and 112px is
   the offset that was already measured to clear Log out at this font size. */
.chrome-account { right: 112px; font-weight: 500; text-decoration: none;
  border: 1px solid var(--border); background: var(--panel); color: var(--text-2); transition: color 0.15s ease, border-color 0.15s ease; }
.chrome-account:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.reveal { opacity: 0; transform: translateY(10px); animation: reveal 0.5s cubic-bezier(0.16,1,0.3,1) forwards; }
@keyframes reveal { to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .reveal { animation: none; opacity: 1; transform: none; } }
summary { list-style: none; cursor: pointer; }
summary::-webkit-details-marker { display: none; }
@media (max-width: 639px) {
  /* Keep every project control reachable without making the document wider
     than the phone. Identity and utilities stay above app navigation. */
  .dashboard-appbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    width: 100%;
  }
  .dashboard-project-switcher { min-width: 0; }
  .dashboard-project-switcher select { width: 100%; min-width: 0; }
  .dashboard-utilities { grid-column: 3; grid-row: 1; }
  .dashboard-app-action {
    display: flex;
    justify-content: center;
    min-height: 40px;
  }
  .dashboard-all-apps { grid-column: 1 / 3; grid-row: 2; }
  .dashboard-new-app { grid-column: 3; grid-row: 2; }

  /* Two compact summary tiles followed by one full-width total keeps large
     event counts legible instead of squeezing them into a narrow column. */
  .dashboard-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard-stats > :nth-child(3) {
    grid-column: 1 / -1;
    border-top: 1px solid var(--border);
    border-left-width: 0;
  }

  /* Issue metadata and triage move below the title on phones. The title owns
     the full content width and every action remains easy to tap. */
  .row-wrap {
    display: grid;
    grid-template-columns: 4px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
  }
  .issue-rail { grid-column: 1; grid-row: 1 / 3; height: 100%; min-height: 44px; }
  .row-link { grid-column: 2 / -1; grid-row: 1; }
  .event-count {
    grid-column: 2;
    grid-row: 2;
    align-self: center;
    justify-content: flex-start;
    width: auto;
  }
  .row-actions { grid-column: 3; grid-row: 2; width: auto; }
  .act { width: 44px; height: 44px; }
  .issue-columns .events-heading { display: none; }
  .issue-columns .page-count { width: auto; }
}


  /* ---- Reporting-period picker (Fathom-style presets + calendar) ---- */
.range-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.25rem;
  padding: 0 0.72rem;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-2);
  font: 600 0.8125rem/1 var(--sans, ui-sans-serif);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}
.range-tool:hover { color: var(--text); border-color: var(--accent); }
.range-tool:active { transform: scale(0.98); }
/* components/AutofixPanel.stx declared its own copy of this, naming .btn,
   .icon-btn and .autofix-input. Two of those three were already covered here
   and by input:focus-visible below, so all it really added was the button --
   which is btn-outline now, and icon-btn-lg joins it. Both reach every page
   instead of only /issue/:id, which is where that copy shipped. */
.range-tool:focus-visible,
.range-link:focus-visible,
.chrome-btn:focus-visible,
.icon-btn:focus-visible,
.icon-btn-lg:focus-visible,
.btn-outline:focus-visible,
select.panel:focus-visible,
input:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.range-tool.is-active { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
.range-tool i { width: 1rem; height: 1rem; }
.date-menu { position: relative; }
.date-menu > summary { list-style: none; }
.date-menu > summary::-webkit-details-marker { display: none; }
.date-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 0.5rem);
  z-index: 40;
  width: min(44rem, calc(100vw - 2.5rem));
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 18px 50px color-mix(in srgb, var(--text) 10%, transparent);
}
/* Period picker: presets down the left, two months on the right. The range is
   drawn flat with rounded ends, the way Fathom's is, on the --bar wash the KPI
   bars already use so it reads as the same accent at the same strength. */
.drp-backdrop { position: fixed; inset: 0; z-index: 39; background: transparent; cursor: default; }
.drp { display: grid; grid-template-columns: 10.5rem minmax(0, 1fr); gap: 0.75rem; }
.drp-presets { display: flex; flex-direction: column; gap: 0.15rem; padding-right: 0.75rem; border-right: 1px solid var(--border); }
.drp-preset {
  display: block;
  width: 100%;
  padding: 0.5rem 0.7rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  font: 500 0.8125rem/1.2 var(--sans, ui-sans-serif);
  text-align: left;
  cursor: pointer;
}
.drp-preset:hover { color: var(--text); background: color-mix(in srgb, var(--text) 6%, transparent); }
.drp-preset.is-active { color: var(--accent-ink); background: var(--accent); }
.drp-cals { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.drp-head { display: grid; grid-template-columns: 2rem minmax(0, 1fr) minmax(0, 1fr) 2rem; align-items: center; gap: 0.35rem; margin-bottom: 0.5rem; }
.drp-nav {
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.drp-nav:hover { color: var(--text); border-color: var(--border); }
.drp-nav svg { width: 1rem; height: 1rem; }
.drp-nav.is-hidden { visibility: hidden; }
.drp-sel {
  min-width: 0;
  height: 2rem;
  padding: 0 0.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: 600 0.8125rem/1 var(--sans, ui-sans-serif);
}
.drp-dow, .drp-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.drp-dow span { padding: 0.25rem 0; color: var(--text-3); font: 600 0.7rem/1.2 var(--sans, ui-sans-serif); text-align: center; }
.drp-day {
  height: 2.25rem;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font: 500 0.8125rem/1 var(--mono, ui-monospace);
  cursor: pointer;
}
.drp-day:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.drp-day.is-out { color: var(--text-3); }
.drp-day.is-today { font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.drp-day.is-range { background: var(--accent-soft); }
.drp-day.is-edge { background: var(--accent); color: var(--accent-ink); border-radius: 8px; }
.drp-day.is-disabled { color: var(--text-3); opacity: 0.45; cursor: default; }
.drp-day.is-disabled:hover { background: transparent; }
.drp-day:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 8px; }
@media (max-width: 640px) {
  .date-menu { position: static; }
  .date-popover { left: 0; right: auto; width: calc(100vw - 2rem); max-height: calc(100dvh - 6rem); overflow-y: auto; overscroll-behavior: contain; }
  .drp { grid-template-columns: minmax(0, 1fr); }
  .drp-presets { flex-direction: row; flex-wrap: wrap; gap: 0.35rem; padding: 0 0 0.6rem; border-right: 0; border-bottom: 1px solid var(--border); }
  .drp-preset { width: auto; padding: 0.45rem 0.65rem; border: 1px solid var(--border); border-radius: 999px; }
  .drp-cals { grid-template-columns: minmax(0, 1fr); }
  .drp-cal.is-right { display: none; }
  .drp-cal.is-left .drp-nav.is-hidden { visibility: visible; }
  .drp-day { height: 2.5rem; }
}
    `,
    /*
     * settings.stx's structural rules: a pseudo-element, an attribute state or
     * a compound selector in every one, so none of them is a shortcut.
     *
     * Smooth scrolling is scoped to the pages that have the in-page nav it is
     * for, rather than made global. public/marketing.css already sets it on
     * html for the marketing pages; /dashboard, /account, /projects and
     * /issue/:id never had it and there is no reason for this move to give it
     * to them.
     */
    `
html:has(.tabnav) { scroll-behavior: smooth; }
.tabnav { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: none; }
.tabnav::-webkit-scrollbar { display: none; }
.tabnav a { flex: none; color: var(--text-2); border: 1px solid var(--border); border-radius: 999px; transition: color .15s ease, border-color .15s ease; }
.tabnav a:hover { color: var(--text); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }

/* The notification toggle. Pseudo-element knob, attribute state. */
.tgl { width: 38px; height: 22px; border-radius: 999px; background: var(--border); position: relative; transition: background 0.15s ease; cursor: pointer; flex: none; }
.tgl::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.tgl[data-on="1"] { background: var(--ok); }
.tgl[data-on="1"]::after { transform: translateX(16px); }

/* Slack / Discord picker. The brand fill is keyed off the selected attribute. */
.seg { border: 1px solid var(--border); border-radius: 10px; color: var(--text-2); background: var(--panel); transition: all 0.12s ease; }
.seg[data-sel="1"] { color: #fff; border-color: transparent; }
.seg-slack[data-sel="1"] { background: var(--slack); }
.seg-discord[data-sel="1"] { background: var(--discord); }

/* Notes rendered from signals, so the state is a class rather than an inline
   style assignment. The colours are the note-ok / note-err / note-failed
   shortcuts; this is the compound that cannot be one. */
.note { display: none; }
.note.show { display: block; }

/* The danger-zone confirm dialog. */
.dz-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(2,4,10,0.62); backdrop-filter: blur(3px); animation: dz-fade 0.12s ease; }
.dz-overlay[hidden] { display: none; }
@keyframes dz-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes dz-pop { from { opacity: 0; transform: translateY(6px) scale(0.98) } to { opacity: 1; transform: none } }
`,

    // account.stx's loading placeholder. `skeleton-pulse`, not `pulse`: this
    // engine emits its own `@keyframes pulse` for `animate-pulse`, and
    // @keyframes obey the cascade, so sharing the name is a silent swap of one
    // animation for the other. The `.skeleton` rule itself is a shortcut.
    '@keyframes skeleton-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }',
    /*
     * /issue/:id: the severity and status chips, the stack trace, the
     * breadcrumb list and the key/value context.
     *
     * Almost none of it could be a class on an element. `.pill.lvl-fatal` and
     * `.frame.is-crash .fr-loc` are compounds, `details.sysgroup > summary
     * ::-webkit-details-marker` has no utility form, `.exc + .exc` and
     * `.crumb:first-child` are positional -- and the level and status names
     * are INTERPOLATED into the class attribute (`pill lvl lvl-{{ … }}`), so
     * an extractor only ever sees whichever one issue happened to render. A
     * preflight always ships, which is the whole answer for this page.
     *
     * The page's own `:root` is gone with it. Its seven overlapping tokens
     * were the defect §11.2 names using this app as the example -- /issue/:id's
     * "same" background being a different colour from /dashboard's -- and they
     * are the shared palette's values now. The six it alone defined moved into
     * that palette; two of them, --panel-2 and --border-2, were already read
     * by the Autofix rules above and worked only because the panel renders on
     * the one page that happened to declare them.
     */
    `
.card-head { display:flex; align-items:center; gap:.5rem; padding:.7rem 1rem; border-bottom:1px solid var(--border-2); font-size:.72rem; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-3); }
.pill { display:inline-flex; align-items:center; gap:.35rem; padding:.15rem .55rem; border-radius:999px; font-size:.7rem; font-weight:600; letter-spacing:.02em; }

/* Severity chips: the one deliberately loud element on the page. Solid
   saturated fills (they carry on both themes) with a soft matching glow so
   the level reads instantly instead of blending into the panel. */
.pill.lvl { color:#fff; font-weight:700; text-transform:uppercase; letter-spacing:.06em; background:#64748b; }
.pill.lvl-fatal { background:#dc2626; box-shadow:0 0 16px rgba(220,38,38,.4); }
.pill.lvl-error { background:#e11d48; box-shadow:0 0 16px rgba(225,29,72,.4); }
.pill.lvl-warning { background:#d97706; box-shadow:0 0 14px rgba(217,119,6,.35); }
.pill.lvl-info { background:#0284c7; }
.pill.lvl-debug { background:#7c3aed; }
/* Status is secondary to severity: outlined + tinted, not solid. */
.pill.st-unresolved { color:var(--accent); background:color-mix(in srgb, var(--accent) 16%, transparent); border:1px solid color-mix(in srgb, var(--accent) 45%, transparent); }
.pill.st-resolved { color:#22c55e; background:rgba(34,197,94,.14); border:1px solid rgba(34,197,94,.4); }
.pill.st-ignored { color:var(--text-3); background:color-mix(in srgb, var(--text-3) 14%, transparent); border:1px solid color-mix(in srgb, var(--text-3) 35%, transparent); }

/* Stack trace */
.exc + .exc { margin-top: .75rem; }
.exc-head { padding: 1rem 1.15rem .9rem; border-bottom:1px solid var(--border-2); }
.exc-type { font-family: var(--mono); font-weight:700; font-size:1rem; color:var(--accent); word-break:break-word; }
.exc-msg { margin-top:.3rem; font-size:.95rem; line-height:1.5; color:var(--text); word-break:break-word; }
.caused { display:inline-block; margin-bottom:.5rem; font-size:.68rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-3); }
.frames { padding:.35rem; }
.frame { display:flex; align-items:baseline; gap:.75rem; padding:.5rem .65rem; border-radius:8px; font-family: var(--mono); font-size:.8rem; line-height:1.45; }
.frame + .frame { margin-top:1px; }
.frame.is-app { background: var(--app-tint); box-shadow: inset 2px 0 0 var(--app-bar); }
.frame.is-sys { opacity:.62; }
/* The crash frame is where the error actually happened — it gets the
   strongest treatment on the page: warmer wash, thicker bar, accent
   filename + location chip. */
.frame.is-crash { background: color-mix(in srgb, var(--accent) 11%, transparent); box-shadow: inset 3px 0 0 var(--accent), 0 0 18px color-mix(in srgb, var(--accent) 12%, transparent); }
.frame.is-crash .fr-base { color: var(--accent); }
.frame.is-crash .fr-loc { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); font-weight:600; }
.fr-main { min-width:0; flex:1; display:flex; align-items:baseline; gap:.4rem; flex-wrap:wrap; }
.fr-base { color: var(--text); font-weight:600; flex-shrink:0; }
.fr-dir { color: var(--text-3); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fr-fn { color: var(--text-2); flex-shrink:0; }
.fr-fn b { color: var(--text); font-weight:600; }
.fr-loc { flex-shrink:0; color: var(--text-3); font-size:.74rem; padding:.05rem .4rem; border-radius:5px; background: var(--code-bg); }
details.sysgroup { margin:1px 0; }
details.sysgroup > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:.5rem; padding:.45rem .65rem; border-radius:8px; font-size:.74rem; color:var(--text-3); font-family: var(--mono); }
details.sysgroup > summary::-webkit-details-marker { display:none; }
details.sysgroup > summary:hover { color: var(--text-2); background: var(--code-bg); }
details.sysgroup > summary .chev { transition: transform .15s ease; }
details.sysgroup[open] > summary .chev { transform: rotate(90deg); }

/* Breadcrumbs */
.crumb { display:flex; align-items:flex-start; gap:.7rem; padding:.5rem 1rem; border-top:1px solid var(--border-2); }
.crumb:first-child { border-top:none; }
.crumb-ic { flex-shrink:0; width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center; }
.crumb-ic svg { width:15px; height:15px; }
.crumb-cat { flex-shrink:0; width:5.5rem; font-family:var(--mono); font-size:.72rem; color:var(--text-2); padding-top:.28rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.crumb-txt { flex:1; min-width:0; font-family:var(--mono); font-size:.75rem; color:var(--text); padding-top:.28rem; word-break:break-word; }
.crumb-time { flex-shrink:0; font-family:var(--mono); font-size:.68rem; color:var(--text-3); padding-top:.32rem; }

/* Key/value context */
.kv { display:grid; grid-template-columns: minmax(6rem,auto) 1fr; gap:.1rem .9rem; padding:.6rem 1rem 1rem; font-size:.78rem; }
.kv dt { color:var(--text-3); font-family:var(--mono); font-size:.72rem; padding:.2rem 0; overflow:hidden; text-overflow:ellipsis; }
.kv dd { color:var(--text); font-family:var(--mono); word-break:break-word; padding:.2rem 0; }
.jsonblock { font-family:var(--mono); font-size:.72rem; line-height:1.5; color:var(--text-2); white-space:pre-wrap; word-break:break-word; padding:.7rem 1rem 1rem; margin:0; }
`,
  ].join('\n')
}

export default {
  // `content` is deliberately absent. stx collects classes by scanning the
  // rendered page rather than globbing the source, and pins `content: []` after
  // the user config for that reason. Five globs used to be declared here and
  // silently did nothing — that was half of stacksjs/stx#1822; the other half
  // was `preflights` replacing crosswind's built-in preflight instead of
  // merging with it, which is what makes the block below safe to add.
  theme: {
    extend: {
      borderRadius: {
        /*
         * The shape roles, same mechanism as the colours above:
         * `rounded-control` and `rounded-pill` resolve as
         * `var(--stx-radius-*, <stock>)` and the stock values are
         * `0.375rem` / `9999px`. Pointed at this app's own radii.
         */
        control: '10px',
        pill: '999px',
        /*
         * `rounded-panel` is @stacksjs/components' radius role name:
         * <EmptyState variant="panel"> renders `bg-panel rounded-panel
         * ring-1 ring-line`. Without this it resolves to nothing and the
         * panel renders square. Pointed at this app's own panel radius:
         * the `panel` shortcut above uses rounded-[12px].
         */
        panel: '12px',
      },
      colors: {
        canvas: 'var(--bg)',
        panel: 'var(--panel)',
        line: 'var(--border)',
        ink: 'var(--text)',
        muted: 'var(--text-2)',
        subtle: 'var(--text-3)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        // `--ok` has existed since this palette was written and was only ever
        // reachable as `var(--ok)` in a page's own CSS. Registering it makes the
        // success state a utility like every other colour here, which is what
        // the resolved chip below needs — `border-[var(--ok)]` is one of the
        // arbitrary border values this crosswind silently drops.
        ok: 'var(--ok)',

        // --- @stacksjs/components' token vocabulary ------------------------
        // The shipped components are written against their own semantic names
        // (text-fg, bg-surface, border-line-strong, …) used 300+ times across
        // the library. `line` and `accent` above already satisfy two of them;
        // the rest resolved to nothing, so a colour-neutral component like
        // <Table> or <Popover> rendered half-styled - `divide-y` applied a
        // border WIDTH while `divide-line` supplied no colour.
        //
        // Aliasing them onto this palette makes those components render in this
        // app's design, in both themes, with no per-call-site className. It is
        // purely additive: nothing here currently uses these names, so no
        // existing markup changes. See statushqorg/status#20.
        //
        // It does NOT fix <Button variant="primary">, which hard-codes
        // bg-blue-500 rather than using its own vocabulary - that is
        // stacksjs/stx#1993.
        surface: 'var(--panel)',
        'surface-sunken': 'var(--bg)',
        'surface-raised': 'color-mix(in srgb, var(--accent) 8%, var(--panel))',
        fg: 'var(--text)',
        'fg-strong': 'var(--text)',
        'fg-muted': 'var(--text-2)',
        /*
         * The library's quiet text scale is four steps - fg, fg-muted, fg-soft,
         * fg-subtle - and this palette has three, so two roles have to share a
         * value. They used to share at the WRONG end: fg-soft was --text-2,
         * byte-identical to fg-muted, which makes "quieter than muted" exactly
         * as loud as muted.
         *
         * Nothing renders it today, which is why this was invisible: of the 53
         * <EmptyState> sites in the estate none passes an `icon` (the only
         * thing there that reads fg-soft) and there is no <Badge dot>. But
         * <Breadcrumb> paints its separators with it, and measured against this
         * app's own background that mapping put a separator at the same
         * contrast as the crumb LINKS beside it - a divider shouting as loud as
         * the things it divides.
         *
         * Doubling up at the quiet end instead keeps the scale monotonic, so a
         * component asking for a quieter grey gets one.
         */
        'fg-soft': 'var(--text-3)',
        'fg-subtle': 'var(--text-3)',
        'line-strong': 'color-mix(in srgb, var(--text-3) 55%, var(--border))',
        'accent-solid': 'var(--accent)',

        // The rest of that vocabulary, added 2026-10-09 so <Badge>, <Tooltip>,
        // <DateRangePicker> and the other role-styled components render in this
        // palette rather than the library's.
        //
        // These MUST be theme.colors entries, not `--stx-*` declarations in a
        // preflight. stx resolves each role as `var(--stx-<name>, <light value>)`
        // and emits its own `:root`/`.dark` block for them; its docs say an app
        // overrides by setting the variable "from its own stylesheet, which comes
        // after". A preflight comes BEFORE, and lands in @layer tc-base, where an
        // unlayered rule beats it whatever the specificity — measured: a
        // preflight `:root { --stx-accent-soft: … }` left every soft variant on
        // the library's light colours (1.05:1 in dark mode) while the roles
        // already aliased here resolved correctly at 19.23:1. Replacing the
        // colour outright sidesteps the variable, and the whole question.
        //
        // The `.dark` half of stx's block never applies here anyway: this app
        // themes with `[data-theme]` and sets `darkClass: null`, so without these
        // every library component would keep its LIGHT values in dark mode.
        content: 'var(--text)',
        page: 'var(--bg)',
        field: 'var(--panel)',
        'field-hover': 'color-mix(in srgb, var(--accent) 8%, var(--panel))',
        'surface-hover': 'color-mix(in srgb, var(--accent) 8%, var(--panel))',
        'surface-sunken-hover': 'color-mix(in srgb, var(--accent) 6%, var(--bg))',
        'surface-raised-hover': 'color-mix(in srgb, var(--accent) 12%, var(--panel))',
        'line-hover': 'color-mix(in srgb, var(--text-3) 40%, var(--border))',
        link: 'var(--accent)',
        'link-hover': 'var(--accent)',
        'accent-solid-hover': 'var(--accent)',
        // color-mix, not `var(--accent-soft)`: that variable is declared in
        // public/marketing.css, which only the marketing pages link, so on a
        // dashboard page it is undefined and `background-color: var(--accent-soft)`
        // is invalid at computed-value time — the badge renders with NO fill.
        'accent-soft': 'color-mix(in srgb, var(--accent) 16%, var(--panel))',
        'accent-soft-ink': 'var(--accent)',

        // Status roles. This design has two: success (`--ok`) and danger
        // (`--warn`, named for the state rather than the hue — it is red in both
        // themes). There is no amber, cyan or purple here, so warning, info and
        // secondary take the neutral treatment instead of the library's
        // light-mode defaults, which would not re-theme. A <Badge variant="warning">
        // reads as neutral in this app, by choice.
        success: 'var(--ok)',
        'success-ink': 'var(--bg)',
        'success-solid': 'var(--ok)',
        'success-solid-hover': 'var(--ok)',
        'success-soft': 'color-mix(in srgb, var(--ok) 16%, var(--panel))',
        'success-soft-ink': 'var(--ok)',
        danger: 'var(--warn)',
        'danger-ink': 'var(--bg)',
        'danger-fg': 'var(--warn)',
        'danger-fg-subtle': 'color-mix(in srgb, var(--warn) 70%, var(--panel))',
        'danger-focus': 'color-mix(in srgb, var(--warn) 45%, transparent)',
        'danger-line': 'color-mix(in srgb, var(--warn) 34%, transparent)',
        'danger-solid': 'var(--warn)',
        'danger-solid-hover': 'var(--warn)',
        'danger-soft': 'color-mix(in srgb, var(--warn) 16%, var(--panel))',
        'danger-soft-ink': 'var(--warn)',
        warning: 'var(--text-2)',
        'warning-ink': 'var(--bg)',
        'warning-solid': 'var(--text-2)',
        'warning-solid-hover': 'var(--text-2)',
        'warning-soft': 'color-mix(in srgb, var(--text-3) 16%, var(--panel))',
        'warning-soft-ink': 'var(--text-2)',
        info: 'var(--text-2)',
        'info-ink': 'var(--bg)',
        'info-solid': 'var(--text-2)',
        'info-solid-hover': 'var(--text-2)',
        'info-soft': 'color-mix(in srgb, var(--text-3) 16%, var(--panel))',
        'info-soft-ink': 'var(--text-2)',
        secondary: 'var(--text-2)',
        'secondary-ink': 'var(--bg)',
        'secondary-solid': 'var(--text-2)',
        'secondary-solid-hover': 'var(--text-2)',
        'secondary-soft': 'color-mix(in srgb, var(--text-3) 16%, var(--panel))',
        'secondary-soft-ink': 'var(--text-2)',

        // Used by the library's tooltips and toasts, which invert.
        inverse: 'var(--text)',
        'inverse-ink': 'var(--bg)',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  /**
   * Shared class primitives, defined once. Each was previously redeclared in
   * every view that used it.
   *
   * A shortcut maps a class name to utility classes, and stx flattens the result
   * into a single `.name { … }` rule. Two consequences worth knowing before
   * adding to this map:
   *
   *   - A utility on the same element cannot override a shortcut, because stx
   *     appends the flattened rule at the END of the sheet
   *     (stx/src/dev-server/crosswind.ts:761). `class="wordmark text-accent"`
   *     does not do what it looks like — put variants inside the shortcut.
   *   - A variant cannot be applied to a shortcut NAME (`hover:wordmark` emits
   *     nothing). Variants belong in the value: `hover:bg-…`.
   *
   * Unknown utilities and unhandled variants emit nothing, silently, so verify
   * against the served /_stx/crosswind.*.css after adding one.
   *
   * A shortcut is only safe when EVERY page agrees on the rule, because a page
   * that declares fewer properties inherits the rest from here. A local rule in
   * a page's <style> does win property-by-property (measured), but only for the
   * properties it actually sets — anything it omits leaks through.
   *
   * That is why `.btn` is absent despite being the most duplicated class in the
   * app. Measured 2026-10-01, the six base definitions are not six copies of one
   * button -- they are FOUR different buttons sharing a name:
   *
   *   outline   public/marketing.css   transparent bg, 1px border, var(--text).
   *                                    Serves every marketing page; pricing.stx
   *                                    adds only `.btn:disabled` on top of it.
   *   panel     AutofixPanel.stx       bg var(--panel), var(--text-2), .8rem.
   *             issue/[id].stx         Identical 12 properties; AutofixPanel
   *                                    alone adds justify-content: center.
   *   solid     projects/index.stx     bg var(--accent), var(--accent-ink),
   *             settings.stx           radius 10px. settings.stx adds only a
   *                                    background/opacity transition.
   *   unpainted account.stx            radius + weight + transition ONLY. The
   *                                    colour comes from `.btn-primary`, so a
   *                                    shared `btn` with a background would
   *                                    paint every plain button on that page.
   *
   * So a single shared `btn` is not a refactor, it is a repaint: it would have to
   * pick one of outline / panel / solid and change the other three surfaces. The
   * two PAIRS above (panel, solid) are genuine duplicates and could be shared
   * today -- but each `.btn` here also anchors a local cascade of `:hover`,
   * `:active`, `:disabled` and modifiers (`.btn-ghost`, `.btn-danger`,
   * `.btn-primary`, `.btn-autofix`) that differ per file, so even the pairs move
   * more than the base rule.
   *
   * `.btn-ghost` is worse, not better: three definitions, all three DIFFERENT
   * (settings.stx paints a panel background, account.stx sets only border+colour,
   * projects/index.stx sets radius+border+colour). `.btn-danger` and `.icon-btn`
   * have one definition each and are not duplicated at all.
   *
   * The open question is a product one, not a technical one: SHOULD the marketing
   * pages, the app shell and the account page have visually different buttons?
   * Until someone answers that, sharing these repaints the app.
   */
  shortcuts: {
    // font-sans resolves to the same stack as var(--sans), so this is identical
    // to the nine copies that omitted the family and inherited it from body.
    wordmark: 'font-sans font-bold tracking-[-0.03em]',
    // font-mono resolves to the same stack as var(--mono). dashboard.stx keeps a
    // local `font-feature-settings: 'tnum' 1` on top of this — tabular figures
    // are deliberate there and were never in the other three copies.
    mono: 'font-mono',

    // Text input. Six copies, byte-identical.
    //
    // The focus ring is part of the shortcut rather than a preflight rule. As
    // `.field:focus` in pageCss it lost its border-color: a preflight lands in
    // @layer tc-base while this shortcut is unlayered, so `.field`'s own
    // border-line beat the layered `.field:focus`. The box-shadow still applied
    // because nothing else set one, which is exactly how that kind of break
    // hides. Here both are unlayered and the focus variant wins normally.
    field: 'bg-canvas border border-solid border-line rounded-[10px] text-ink '
      + 'focus:outline-none focus:border-accent '
      + 'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_16%,transparent)]',

    // The primary submit button on the five auth-shaped forms: /login,
    // /register, /forgot-password, /reset-password and /projects/new. All five
    // declared these four rules identically.
    //
    // Named rather than folded into `btn` on purpose. Ten files use `class="btn"`
    // with six different definitions, and the other five are genuinely different
    // components — account.stx and pricing.stx colour theirs via `.btn.primary`
    // and set no background of their own, so a shared `btn` would paint every
    // plain button on those pages accent. This owns one of the six and leaves
    // the rest to their pages.
    // `!` on exactly the five properties <Button> also sets.
    //
    // The six call sites are <Button className="btn-accent"> now, and a
    // component's utilities and this shortcut are both single-class
    // selectors -- equal specificity, so source order decides and crosswind
    // sorts its output by category rather than by generation. Without `!`
    // the override is PARTIAL: measured, this shortcut beat the component's
    // radius and background but lost its padding, which is worse than not
    // overriding at all. `!` does not care about order.
    //
    // Only those five carry it. `w-full` comes from Button's own fullWidth,
    // and leaving the rest unmarked keeps a per-site className useful.
    //
    // py/text moved in from the call sites, which all declared
    // `py-2.5 w-full font-semibold text-sm` identically. shadow-none because
    // Button's primary variant adds shadow-md and these buttons never had one.
    //
    // ## The accent button, and the end of `.btn`
    //
    // The paint is `btn-solid` and this is that plus the auth form's size,
    // because a shortcut may reference another shortcut -- the engine expands
    // it before generating, checked against the installed one rather than
    // assumed. That matters because settings.stx, projects/index.stx and
    // account.stx each declared this same button in their own `<style>` block
    // under the name `.btn`, and they were not three buttons. Measured
    // declaration by declaration: all three are `background: var(--accent)`,
    // `color: var(--accent-ink)`, `border-radius: 10px` and the same
    // `color-mix(… 88%, #000)` on hover. What differed was the transition list,
    // and only because each copy named the properties its own page happened to
    // animate. `btn-solid` takes the union, which is why the six auth buttons'
    // hover fill now eases instead of snapping -- account.stx's copy always did.
    //
    // account.stx's `:disabled` was 55% where this was 60%. One of them had to
    // go; 60% is the one six working call sites already use.
    'btn-solid': 'bg-accent text-accent-ink !rounded-[10px] '
      + '!shadow-none hover:!shadow-none font-semibold '
      + '[transition:transform_0.12s_ease,opacity_0.15s_ease,background-color_0.15s_ease] '
      + 'hover:bg-[color-mix(in_srgb,var(--accent)_88%,#000)] '
      + 'active:translate-y-px '
      + 'disabled:!opacity-60 disabled:cursor-default',

    'btn-accent': 'btn-solid !py-2.5 !text-sm',

    /*
     * The small panel-outline button. issue/[id].stx declared it as `.btn` and
     * components/AutofixPanel.stx as `.autofix-card .btn`, and those two were
     * byte-identical apart from AutofixPanel adding `justify-content: center`
     * (no effect on an inline-flex that sizes to its content) and issue/[id]
     * marking five properties `!important`.
     *
     * The marks are kept, on exactly the five <Button variant="ghost"> also
     * sets -- gap, padding, radius, font-size and colour. Both the component's
     * utilities and this shortcut are single-class selectors, so specificity
     * ties and crosswind sorts its output by category rather than by generation
     * order; without the marks the override is PARTIAL, which is worse than
     * none. Marked across the whole family, because an `!important` base
     * outranks its own un-marked `:hover`.
     */
    'btn-outline': 'inline-flex items-center justify-center !gap-[0.4rem] !px-[0.8rem] !py-[0.4rem] '
      + '!rounded-[9px] !text-[0.8rem] font-semibold border border-solid border-line bg-panel '
      + '!text-muted cursor-pointer '
      + '[transition:color_0.12s_ease,border-color_0.12s_ease,background-color_0.12s_ease,transform_0.12s_ease] '
      + 'hover:!text-ink hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] '
      + 'hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] '
      + 'active:translate-y-px',

    /*
     * The accent-filled variant of it, for AutofixPanel's one CTA.
     *
     * It was a pageCss rule and it had stopped working. A preflight lands in
     * `@layer tc-base`, the `.autofix-card .btn` that used to sit beside it was
     * unlayered, and an unlayered rule beats a layered one at any specificity --
     * so `color: #fff` lost to `color: var(--text-2)`, and the one CTA on the
     * panel rendered as a plain outline button. issue/[id].stx's `.btn` carried
     * `color: var(--text-2) !important` as well, which made it certain.
     *
     * As a shortcut it is unlayered like `btn-outline`, so it needs the marks
     * for the same reason `btn-accent` does.
     */
    'btn-autofix': '!text-[#fff] !bg-[color-mix(in_srgb,var(--accent)_78%,#0b0f19)] !border-transparent whitespace-nowrap '
      + 'hover:!text-[#fff] hover:!bg-[color-mix(in_srgb,var(--accent)_88%,#0b0f19)] hover:!border-transparent',

    /*
     * projects/index.stx's icon button, which is deliberately not `icon-btn`:
     * 36px instead of 34, radius 10 instead of 9, --text-3 instead of --text-2
     * and an 18px glyph, because at 36px it matches the height of the "+ New
     * app" button beside it exactly. Its `<style>` block used to override all
     * eleven of `icon-btn`'s properties to get there; the call site names this
     * instead, so nothing is overridden at all.
     */
    'icon-btn-lg': 'inline-flex items-center justify-center w-[36px] h-[36px] '
      + 'border border-solid border-line rounded-[10px] text-subtle bg-panel cursor-pointer '
      + '[transition:color_0.15s_ease,border-color_0.15s_ease] '
      + 'hover:text-ink hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] '
      + '[&_svg]:w-[18px] [&_svg]:h-[18px]',

    /*
     * account.stx's surfaces. None of these names appears in
     * public/marketing.css, so there is nothing for an unlayered shortcut to
     * clobber on the 24 marketing pages -- which is the question that decides
     * shortcut-or-preflight every time in this file.
     *
     * `row-rule`, not `row`: a shortcut is global, and `row` is a name a future
     * template reaches for without meaning a top border.
     */
    badge: 'border border-solid border-line rounded-[999px] [font-family:var(--mono)] '
      + 'text-[11px] tracking-[0.04em] uppercase text-muted',
    'badge-pro': 'border-accent text-accent',
    avatar: 'rounded-[999px] object-cover bg-[color-mix(in_srgb,var(--accent)_14%,var(--panel))]',
    'row-rule': 'border-t border-solid border-line',
    // `skeleton-pulse`, not `pulse`: this engine emits its own `@keyframes
    // pulse` for `animate-pulse`, and @keyframes obey the cascade, so sharing
    // the name is a silent swap of one animation for the other.
    skeleton: 'bg-[color-mix(in_srgb,var(--text-3)_20%,transparent)] rounded-[6px] '
      + 'animate-[skeleton-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none',

    // Raised surface. Three copies, byte-identical.
    panel: 'bg-panel border border-solid border-line rounded-[12px]',

    /*
     * The app's card. account.stx and issue/[id].stx declared this
     * byte-identically -- 15 call sites, two copies of three properties.
     *
     * It was held back while a third file disagreed about what `.card` meant:
     * pricing.stx painted `var(--surface)` at `var(--r)`, which are
     * marketing.css's variables and resolve to nothing on an app page, so a
     * global `card` would have been a repaint rather than a hoist. pricing is
     * on `card-tier` now, so the name is free.
     *
     * 14px rather than the 12px `panel` uses, which is the one thing here that
     * looks like drift and is not: `rounded-panel` is @stacksjs/components'
     * radius role and is pointed at 12px so <EmptyState variant="panel">
     * matches the panels it sits among. These cards have always been 14.
     */
    card: 'bg-panel border border-solid border-line rounded-[14px]',

    /*
     * The app tiles on /projects, which are whole-card links and the only
     * cards in the app that react to the pointer. Painting comes from `panel`
     * on the same element, so this is the reaction and nothing else -- which
     * is why it could not stay named `card` once that name became the painted
     * one above: the tile would have picked up a second border-radius.
     *
     * The hover border-color is `hover:border-[color-mix(…)]` rather than the
     * arbitrary-property form, and that was once the only spelling that
     * worked: `hover:[border-color:…]` parsed and emitted NOTHING, because a
     * variant did not reach that form at all. Filed as stacksjs/ts-css#36 and
     * fixed in **0.3.14** for the generator, then #37 in **0.3.16** for the
     * extractor, which is what made the fix reachable from a real build. Both
     * also cover `focus:[…]` and `md:[…]`.
     *
     * This app resolves 0.3.16 now, and `hover:[border-color:red]` does emit
     * here -- measured through this app's own loader. It stays as it is anyway:
     * `hover:border-[…]` is the more idiomatic spelling and changing a working
     * shortcut buys nothing.
     *
     * The habit the episode is worth keeping: both spellings parse, and the
     * broken one failed with no error and no rule. Measure a variant against
     * the generated sheet rather than reading it and assuming.
     */
    'card-lift': '[transition:border-color_0.15s_ease,transform_0.12s_ease] '
      + 'hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] '
      + 'hover:-translate-y-px',

    /*
     * The outline button. Three definitions, and unlike `card` they were never
     * byte-identical -- they disagreed on the two things you can see:
     *
     *   settings.stx          --text-2 at rest, 9px, both !important, plus a
     *                         panel background and a colour/border transition.
     *   projects/index.stx    --text, 10px. Background comes from `bg-panel`
     *                         on the element.
     *   account.stx           --text, no radius of its own (it rides the 10px
     *                         from that page's `.btn`), no background.
     *
     * Unified on --text at 10px, which is what two of the three already were
     * and is a deliberate product call rather than a measurement: settings'
     * ghost buttons go from muted to full-strength text and gain 1px of
     * radius. Nothing else here changes what renders.
     *
     * The !important came off, and settings.stx's comment explains what it was
     * for: two of those call sites are <Button variant="ghost">, which brings
     * @stacksjs/components' own `text-fg-strong` and `rounded-control`, and a
     * page rule of equal specificity needed the mark to beat them.
     *
     * It is safe to drop because of what those two tokens resolve to HERE,
     * measured rather than assumed: `text-fg-strong` is `color: var(--text)`
     * and `rounded-control` is `border-radius: 10px` -- the very values this
     * shortcut sets. Unifying on --text at 10px happens to land exactly where
     * the component was already aiming, so there is nothing left to override.
     * The shortcut is also emitted after both, so it wins on order regardless.
     *
     * Neither Button adds `.btn`, so settings' own accent-filled
     * `.btn { … !important }` never touches these. The modifiers they do carry
     * -- `.btn-xs`, `.btn-dz` -- set padding and type only.
     *
     * What this does mean: the mark is load-bearing again the moment those
     * tokens move. If `rounded-control` stops being 10px, these buttons follow
     * it instead of this shortcut, and the test below is what would say so.
     *
     * Background stays OFF this shortcut and on the element, because the three
     * pages genuinely differ: settings and projects/index both want a panel,
     * account wants none. settings' markup now carries `bg-panel` the way
     * projects/index.stx already did, so all three keep the surface they have.
     *
     * The transition is the one addition, and it lands on two of the three.
     * All three change border-color on hover and only settings animated it, so
     * animating it in the shared rule is the consistent reading of a hover
     * that already exists. account.stx is the exception and stays as it is:
     * its buttons are `btn btn-ghost`, its own `.btn` declares a competing
     * transition, and both selectors are unlayered single-class ones, so
     * source order decides -- the page block is inside <main> and therefore
     * later than the generated sheet, so `.btn` keeps winning there.
     *
     * `hover:border-[…]` rather than `hover:[border-color:…]` for the reason
     * card-lift gives above -- this app resolves 0.3.12, where the variant
     * form emits nothing.
     */
    'btn-ghost': 'border border-solid border-line text-ink rounded-[10px] '
      + '[transition:color_0.15s_ease,border-color_0.15s_ease] '
      + 'hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]',

    /*
     * The two plan cards on /pricing, and the reason this pair exists at all.
     *
     * pricing.stx declared them in `@push('styles')`, which the marketing
     * layout renders into <head> (layouts/marketing.stx:56). The SPA router
     * only removes `style[data-crosswind]` and `style[data-stx-page]`, so a
     * block in the head outlives the page that pushed it: entering on /pricing
     * and clicking through left all eight of its rules live for the rest of the
     * session, and its `.card` -- `var(--surface)`, radius `var(--r)` -- then
     * repainted every `.card` on every app page, which mean a panel at 14px.
     * Measured 2026-10-13: of the seven views still carrying a <style> block,
     * pricing was the ONLY one outside <main>, and so the only one that leaked.
     *
     * `-pro` is a complete card rather than a modifier on top of `card-tier`.
     * The two differ on border-color, and a modifier would have had to beat the
     * base on it: both are single-class selectors, so specificity ties and
     * source order decides, and crosswind sorts its output by category rather
     * than by generation. Spelling the pro card out in full removes the
     * question instead of answering it with `!important`.
     *
     * `--surface` and `--r` come from public/marketing.css, not from the
     * preflights below, so these two belong to the marketing pages. The
     * palette here has no --surface: `bg-surface` is an alias onto --panel for
     * @stacksjs/components, which is a different colour.
     */
    'card-tier': 'bg-[var(--surface)] border border-solid border-line rounded-[var(--r)]',
    'card-tier-pro': 'bg-[var(--surface)] border border-solid rounded-[var(--r)] '
      + '[border-color:color-mix(in_srgb,var(--accent)_55%,var(--border))] '
      + '[box-shadow:0_12px_40px_color-mix(in_srgb,var(--accent)_12%,transparent)]',

    // Metadata chip on an issue row: status, environment, release, "new in this
    // release". Quiet by default — this sits under the title and must not
    // compete with it or with the level colour on the same row.
    //
    // Colours come from the registered theme keys, not `border-[color-mix(…)]`.
    // This crosswind emits the arbitrary value for `bg-` but silently drops it
    // for `border-`, so a color-mixed border produced a rule with the text
    // colour and no border at all — visible only by reading the generated CSS,
    // since the chip still had `.tag`'s border underneath.
    tag: 'inline-flex items-center px-1.5 py-0.5 rounded-[5px] border border-solid '
      + 'border-line text-subtle leading-none whitespace-nowrap',
    // Production is the environment worth spotting at a glance; staging and the
    // rest stay in the default grey rather than each earning a colour.
    'tag-prod': 'text-muted',
    // The one chip that is a finding rather than a label, so it gets the accent.
    'tag-new': 'text-accent border-accent',
    // A row that is done. Green rather than grey because this is the one chip
    // that contradicts the row it sits on — everything else about a resolved
    // issue (level rail, error type, event count) still reads as a live problem.
    'tag-resolved': 'text-ok border-ok',

    // Square icon button — theme toggle, copy, row actions. dashboard.stx,
    // settings.stx and issue/[id].stx declare this identically.
    //
    // projects/index.stx keeps its own: 36px instead of 34, radius 10 instead of
    // 9, --text-3 instead of --text-2, and an 18px glyph. Measured rather than
    // assumed to be drift — at 36px it matches the height of the "+ New app"
    // button beside it exactly, where 34px would sit 2px short. It declares all
    // eleven of the same properties, so it overrides this cleanly with nothing
    // leaking through.
    'icon-btn': 'inline-flex items-center justify-center w-[34px] h-[34px] '
      + 'border border-solid border-line rounded-[9px] text-muted bg-panel cursor-pointer '
      + '[transition:color_0.15s_ease,border-color_0.15s_ease] '
      + 'hover:text-ink hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] '
      + '[&_svg]:w-[17px] [&_svg]:h-[17px]',

    // The bughq column of a /compare/* table: every second cell of each group of
    // three. Structural, so it needs the arbitrary-variant form rather than a
    // class on each cell. Lives here rather than in a preflight so that it is
    // unlayered and outranks marketing.css's `.cmp-cell` background; see the
    // note in pageCss().
    'cmp-hl': '[&_.cmp-cell:nth-child(3n+2)]:bg-[var(--accent-soft)]',

    // The six status badges in settings.stx are <Badge> now, and these three
    // carry the difference between the library's badge and this app's.
    //
    // `badge-hq` is the type only. <Badge size="sm"> is 12px/500 with no
    // tracking; these rows have always been 11px/600 at 0.02em, and they sit in
    // dense member and channel lists where a 12px label crowds the email beside
    // it. Padding differs by a single pixel horizontally, carried for the same
    // reason. `!` on every property for the reason btn-accent documents above:
    // a shortcut and a component's own utilities are both single-class
    // selectors, so without `!` the override lands only where crosswind happens
    // to sort this shortcut after the component.
    'badge-hq': '!text-[11px] !font-semibold !tracking-[0.02em] !px-[9px]',

    /*
     * The box an inline form notice sits in: the error banner above a form and
     * the confirmation that replaces it. Eight sites across the five
     * auth-shaped views spelled `px-3 text-sm rounded-lg` out in full,
     * identically.
     *
     * Geometry only, and that is load-bearing rather than tidy. `.err` is
     * declared in the preflight below, which is LAYERED, and pricing.stx
     * deliberately overrides it unlayered with `background: transparent` for
     * its own smaller notice. Folding the colour in here would make `.err` an
     * unlayered shortcut too, so pricing's override would stop winning on layer
     * and start tying on specificity with source order deciding. Leaving the
     * colour where it is keeps that override deterministic.
     *
     * The vertical padding stays at the call site for a different reason:
     * errors sit at py-2 and confirmations at py-3 across this app, analyticshq
     * and loghq alike, so it is a real axis rather than an oversight. Folding
     * in the more common one would mean `!py-3` on a quarter of the sites.
     */
    'notice-box': 'px-3 text-sm rounded-lg',

    /*
     * The theme toggle's icon swap and the wordmark link, hoisted out of the
     * page <style> blocks that each carried their own copy: the three
     * theme-btn rules were byte-identical in dashboard, settings, issue/[id]
     * and projects/index, and the two wordmark rules in dashboard and settings.
     * Sixteen rule instances, one definition.
     *
     * ONLY the byte-identical ones. A shortcut is global the moment it exists,
     * so hoisting a selector that means different things on different pages
     * would be a behaviour change, not a refactor: `.btn`, `.card`,
     * `.btn-ghost`, `.pill`, `.seg` and `.btn:disabled` all still differ
     * between the files that declare them, and they stay where they are.
     * `.btn:active` is identical in account.stx and issue/[id].stx, and is
     * NOT hoisted either, because settings and projects have a `.btn` with no
     * :active and a global rule would start nudging those buttons too.
     *
     * The call sites already read `class="icon-btn theme-btn"` and
     * `class="wordmark-link"`, so the names are deliberately unchanged and no
     * markup moves.
     *
     * The attribute form is what makes this expressible at all: `[&_.ic-sun]`
     * for a descendant and `[&[data-t="light"]_.ic-sun]` for a descendant under
     * a state on the element itself. `[color:inherit]` rather than
     * `text-[inherit]`, which crosswind reads as a font-size.
     */
    'theme-btn': '[&_.ic-sun]:hidden [&_.ic-moon]:hidden '
      + '[&[data-t="light"]_.ic-sun]:block [&[data-t="dark"]_.ic-moon]:block',
    'wordmark-link': '[color:inherit] no-underline '
      + '[transition:opacity_0.15s_ease] hover:opacity-75',

    // Slack and Discord brand fills, the one pair of badges whose colour is not
    // a role. Not variants: both are a vendor's own colour and mean nothing in
    // this palette, so they override <Badge variant="default"> rather than
    // asking the role vocabulary to name them. Moved out of settings.stx's
    // <style> block, where `.badge-slack` sat beside a generic `.badge` that
    // leaked to every page the router kept the sheet alive for.
    'badge-slack': '!bg-[var(--slack)] !text-white',
    'badge-discord': '!bg-[var(--discord)] !text-white',

    /*
     * The snoozed tag's muted treatment. A shortcut and not a pageCss rule,
     * because it exists to override `tag`, which is also a shortcut and sets
     * `color: var(--text-3)`. In a preflight it would land in @layer cw-base
     * and lose to that unlayered `.tag` whatever the source order, and snoozed
     * rows would come back at full strength.
     *
     * The bang is for the same reason the badge pair above carries one: two
     * shortcuts are both unlayered single-class rules, so nothing but output
     * order decides them, and class attribute order is not output order.
     */
    'tag-snoozed': '!text-muted bg-[color-mix(in_srgb,var(--text-3)_14%,var(--panel))]',

    /*
     * ## settings.stx
     *
     * Its `<style>` block was 85 lines and the largest left in the app. What is
     * here is the part that is a bag of properties on one class; what is in
     * pageCss() is the part with a pseudo-element, an attribute state or a
     * compound selector.
     *
     * Each of these had to be a shortcut rather than a preflight rule, and in
     * two cases that is not a style preference:
     *
     *   `field-quiet` overrides `field`'s focus ring, and `field` is a shortcut
     *     -- unlayered. The same override as a `.field:focus` preflight rule is
     *     a bug this file has already had and fixed once: a preflight lands in
     *     @layer tc-base, so `.field`'s own `border-line` beat the layered
     *     `.field:focus` and only the box-shadow survived, because nothing else
     *     set one. See the note on `field` above.
     *
     *   `danger-panel` sits on `class="danger-panel panel"`, and `panel` is a
     *     shortcut that sets `border-color`. Layered, this rule loses and the
     *     destructive section loses its warn-tinted border.
     *
     * The `!` marks follow the rule the rest of this file uses: on exactly the
     * properties something unlayered also sets, because specificity ties and
     * crosswind sorts its output by category rather than by generation order.
     */
    sec: 'scroll-mt-[84px]',
    'sec-title': 'text-[13px] font-semibold tracking-[0.04em] uppercase text-subtle',
    'field-quiet': 'focus:!border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] focus:![box-shadow:none]',
    'danger-panel': '!border-[color-mix(in_srgb,var(--warn)_40%,var(--border))]',
    'code-block': 'bg-canvas border border-solid border-line rounded-[10px] text-muted '
      + '[font-family:var(--mono)] text-[12px] leading-[1.5] px-4 py-3 pr-16 overflow-x-auto',
    'copy-btn': 'absolute top-2 right-2 [font:500_11px/1_var(--sans)] px-[9px] py-[5px] rounded-[7px] '
      + 'border border-solid border-line bg-panel text-subtle cursor-pointer '
      + '[transition:color_.15s_ease,border-color_.15s_ease] '
      + 'hover:text-ink hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]',
    'dz-div': 'h-px bg-[color-mix(in_srgb,var(--warn)_20%,var(--border))]',
    'dz-card': 'w-full max-w-[440px] p-[22px] [box-shadow:0_24px_70px_rgba(0,0,0,0.5)] '
      + 'animate-[dz-pop_0.14s_cubic-bezier(0.2,0.8,0.3,1)]',
    // The three note colours. `.note` itself and its `.show` toggle are a
    // compound selector, so they stay in pageCss().
    'note-ok': 'text-[var(--ok)]',
    'note-err': 'text-accent',
    'note-failed': 'text-[var(--warn)]',

    /*
     * The destructive button, and the three sizes the block carried beside it.
     *
     * Every rule in the family is marked, not just the base: an !important base
     * outranks its own un-marked :hover, which would have stopped the danger
     * fill turning its label white.
     *
     * `:disabled` matters more here than it reads. `.btn` has had a disabled
     * state since the start and `.btn-danger` never got one, while every
     * `:disabled` binding in settings.stx lands on a danger button -- Rotate
     * while a rotation is in flight, each Remove while its request is, and the
     * confirm that stays inert until the typed phrase matches. The hover
     * override restores all three properties because `transition: all` means a
     * partial reset animates back to the danger fill.
     */
    'btn-danger': 'border border-solid border-[color-mix(in_srgb,var(--warn)_45%,var(--border))] '
      + '!text-[var(--warn)] !rounded-[10px] bg-panel [transition:all_0.15s_ease] '
      + 'hover:!text-[#fff] hover:bg-[var(--warn)] hover:border-[var(--warn)] '
      + 'disabled:!opacity-55 disabled:cursor-default '
      + 'disabled:hover:!text-[var(--warn)] disabled:hover:bg-panel '
      + 'disabled:hover:border-[color-mix(in_srgb,var(--warn)_45%,var(--border))]',
    // The sizes stay separate from the paint, the way btn-solid and btn-accent
    // do. They are marked because <Button variant="ghost"> sets padding, size
    // and weight itself.
    'btn-sm': '!px-3 !py-2 !text-sm !font-medium',
    'btn-xs': '!px-2.5 !py-1.5 !text-xs !font-medium',
    // `flex-none` and `whitespace-nowrap` are the two that used to emit nothing
    // at all: they sat as utilities on these buttons, on a page the extractor
    // never reaches. In a safelisted shortcut they ship.
    'btn-dz': 'flex-none !px-4 !py-2.5 !text-sm !font-semibold whitespace-nowrap',

    /*
     * /issue/:id's three button variants, each a complete button rather than a
     * modifier set beside `btn-outline`.
     *
     * They compose it instead: a shortcut may reference another shortcut, and
     * the later utilities override the earlier ones inside the one rule the
     * engine emits. That is the difference that matters -- as a modifier,
     * `.btn-resolve`'s green would have to beat `btn-outline`'s own
     * `!text-muted` at equal specificity, where the winner is whichever
     * crosswind emitted last, and pickier's class sorter is entitled to
     * rewrite the attribute order that decides it. Composed, there is one
     * rule and one colour in it.
     */
    'btn-resolve': 'btn-outline !text-[#16a34a] border-[rgba(34,197,94,.4)] '
      + 'hover:!text-[#16a34a] hover:border-[rgba(34,197,94,.75)] hover:bg-[rgba(34,197,94,.1)]',
    // The copy button beside a stack frame: the same button in mono, a size down.
    'btn-copy': 'btn-outline [font-family:var(--mono)] !text-[0.68rem]',
    'backlink': 'text-muted [transition:color_.12s_ease] hover:text-ink',

    // Third-party sign-in button on /login and /register. Two copies, identical.
    'oauth-btn': 'border border-solid border-line rounded-[10px] text-ink bg-panel '
      + '[transition:border-color_0.15s_ease,transform_0.12s_ease] '
      + 'hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] '
      + 'active:translate-y-px',
  },
  /*
   * Names the extractor cannot reach.
   *
   * Crosswind generates from the RENDERED page: a safelist entry first, then
   * every class it finds in a `class=` attribute. Four of this app's pages --
   * /account, /projects, /settings and /issue/:id -- put their whole body
   * behind `@if (user …)`, so a build with no session renders a loading shell
   * and the real markup is never scanned. settings.stx recorded the symptom
   * before the cause was understood: `flex-none` and `whitespace-nowrap` sat on
   * two of its buttons and emitted no CSS at all, while `px-4` and `py-2.5`
   * worked only because a public page happens to use them.
   *
   * A preflight always ships, which is why the rules in pageCss() never had
   * this problem and why hand-written CSS kept winning the argument. A
   * safelisted shortcut always ships too, which is what lets the same CSS be a
   * shortcut instead.
   *
   * `btn-autofix` is here for a second reason: AutofixPanel.stx computes that
   * class name in a client function, so it is not in any rendered attribute at
   * all, on any page, signed in or not.
   */
  safelist: [
    'btn-solid',
    'btn-outline',
    'btn-autofix',
    'icon-btn-lg',
    'badge',
    'badge-pro',
    'avatar',
    'row-rule',
    'skeleton',
    'active:translate-y-px',
    // settings.stx
    'sec',
    'sec-title',
    'field-quiet',
    'danger-panel',
    'code-block',
    'copy-btn',
    'dz-div',
    'dz-card',
    'note-ok',
    'note-err',
    'note-failed',
    'btn-danger',
    'btn-sm',
    'btn-xs',
    'btn-dz',
    // issue/[id].stx
    'btn-resolve',
    'btn-copy',
    'backlink',
  ],
  preflights: [
    { getCSS: paletteCss },
    { getCSS: pageCss },
    // Scoped to the marketing layout group; the two above are site-wide.
    // LAST, so where a name is declared in both this and pageCss -- `.reveal`
    // is the only one -- the marketing value wins on these pages. It also wins
    // on specificity, the prefix being more specific than a bare class.
    { getCSS: () => MARKETING },
  ],
  preflight: true,
  minify: false,
}
