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
  text3: '#97a1b2',
  accent: '#e11d48',
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
  text3: '#667085',
  accent: '#fb7185',
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
      colors: {
        canvas: 'var(--bg)',
        panel: 'var(--panel)',
        line: 'var(--border)',
        ink: 'var(--text)',
        muted: 'var(--text-2)',
        subtle: 'var(--text-3)',
        accent: 'var(--accent)',
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
   */
  shortcuts: {
    // font-sans resolves to the same stack as var(--sans), so this is identical
    // to the nine copies that omitted the family and inherited it from body.
    wordmark: 'font-sans font-bold tracking-[-0.03em]',
    // font-mono resolves to the same stack as var(--mono). dashboard.stx keeps a
    // local `font-feature-settings: 'tnum' 1` on top of this — tabular figures
    // are deliberate there and were never in the other three copies.
    mono: 'font-mono',
  },
  preflights: [
    { getCSS: paletteCss },
  ],
  preflight: true,
  minify: false,
}
