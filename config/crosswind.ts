/**
 * Crosswind (utility CSS) config.
 *
 * The palette is registered here as semantic color tokens backed by the CSS
 * custom properties defined per-page (`--bg`, `--panel`, `--border`, `--text*`,
 * `--accent`). That gives real utilities (`bg-panel`, `text-subtle`,
 * `border-line`, `text-accent`) instead of inline `style="color: var(--…)"`,
 * while the vars still swap under `[data-theme]` / `prefers-color-scheme` so
 * dark mode keeps working without a `dark:` on every class.
 *
 * @see https://github.com/cwcss/crosswind
 */
export default {
  content: [
    './resources/views/**/*.{stx,html}',
    './resources/**/*.{stx,html}',
    './storage/framework/defaults/resources/views/**/*.{stx,html}',
    './storage/framework/defaults/resources/components/**/*.{stx,html}',
    './storage/framework/core/error-handling/src/views/**/*.{stx,html}',
  ],
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
  preflight: true,
  minify: false,
}
