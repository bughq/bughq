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
}

/**
 * Mode-independent values. Slack's brand colour does not change between themes,
 * and the two font stacks are the same strings crosswind's `fontFamily` above
 * resolves `font-sans` / `font-mono` to — declared here as well because plain
 * CSS in the views selects them via `var(--sans)` / `var(--mono)`.
 */
const constants = [
  `--slack: #611f69`,
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
function pageCss(): string {
  return [
    // The /compare/* tables, which declared this identically in eight pages.
    //
    // Only `.cmp-note` lives here. The column highlight is a `cmp-hl` shortcut
    // instead, because it has to beat `.cmp-cell { background: var(--surface) }`
    // in public/marketing.css. That file is unlayered and everything returned
    // from a preflight lands in `@layer tc-base`, and an unlayered rule wins
    // over a layered one whatever the specificity. As a preflight the highlight
    // silently stopped applying; as a shortcut it compiles to an unlayered
    // utility and wins. Nothing competes with `.cmp-note`, so it is fine here.
    '.cmp-note { margin-top: 1rem; color: var(--text-3); font-size: 0.86rem; line-height: 1.55; max-width: 68ch; }',

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
    // `.hero-code .code-bar` is NOT here. It differed from marketing.css's
    // `.code-bar` only in gap (0.55 vs 0.6rem) and padding (0.8 vs 0.75rem),
    // and marketing.css is unlayered, so as a preflight it would have lost and
    // the hero would have silently taken the marketing values. Those two
    // numbers are utilities on the element now and the rest of the rule, which
    // was identical, is gone.
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
        'fg-soft': 'var(--text-2)',
        'fg-subtle': 'var(--text-3)',
        'line-strong': 'color-mix(in srgb, var(--text-3) 55%, var(--border))',
        'accent-solid': 'var(--accent)',
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
    'btn-accent': 'bg-accent text-accent-ink !rounded-[10px] !py-2.5 !text-sm '
      + '!shadow-none hover:!shadow-none font-semibold '
      + '[transition:transform_0.12s_ease,opacity_0.15s_ease] '
      + 'hover:bg-[color-mix(in_srgb,var(--accent)_88%,#000)] '
      + 'active:translate-y-px '
      + 'disabled:!opacity-60 disabled:cursor-default',

    // Raised surface. Three copies, byte-identical.
    panel: 'bg-panel border border-solid border-line rounded-[12px]',

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

    // Third-party sign-in button on /login and /register. Two copies, identical.
    'oauth-btn': 'border border-solid border-line rounded-[10px] text-ink bg-panel '
      + '[transition:border-color_0.15s_ease,transform_0.12s_ease] '
      + 'hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] '
      + 'active:translate-y-px',
  },
  preflights: [
    { getCSS: paletteCss },
    { getCSS: pageCss },
  ],
  preflight: true,
  minify: false,
}
