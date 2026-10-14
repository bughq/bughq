import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import theme from '../../config/crosswind'
// The installed STX package does not export these subpaths by bare specifier.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const ROOT = join(import.meta.dir, '../..')

/*
 * dashboard.stx's <style> block is config/crosswind.ts pageCss() now
 * (stx-standards rule 3), so the rules below are generated rather than read out
 * of the view. That is the stronger assertion: a rule can sit in the config and
 * still not reach the page, and matching the source text never proved it did.
 */
async function dashboardCss(): Promise<string> {
  const engine = await loadCssEngine()
  if (!engine)
    throw new Error('The installed STX CSS engine is required')
  const merged = mergeCssConfig(engine.defaultConfig || engine.config, theme)
  const generator = new engine.CSSGenerator(merged.config)
  for (const className of engine.extractClasses(dashboard))
    generator.generate(className)
  return generator.toCSS(merged.includePreflight, merged.minify)
}
const dashboard = readFileSync(join(ROOT, 'resources/views/dashboard.stx'), 'utf8')
const settings = readFileSync(join(ROOT, 'resources/views/settings.stx'), 'utf8')
const marketing = readFileSync(join(ROOT, 'public/marketing.css'), 'utf8')

describe('mobile layout contracts', () => {
  test('dashboard gives its toolbar and issue rows mobile layout hooks', () => {
    expect(dashboard).toContain('dashboard-appbar')
    expect(dashboard).toContain('dashboard-project-switcher')
    expect(dashboard).toContain('dashboard-stats')
    expect(dashboard).toContain('issue-rail')
    expect(dashboard).toContain('event-count')
  })

  test('dashboard switches to contained grids and touch-sized triage controls', async () => {
    const css = await dashboardCss()
    expect(css).toContain('@media (max-width: 639px)')
    expect(css).toContain('grid-template-columns: auto minmax(0, 1fr) auto;')
    expect(css).toContain('grid-template-columns: 4px minmax(0, 1fr) auto;')
    // 44px is the touch target, and it only applies inside the phone query.
    expect(css).toContain('.act { width: 44px; height: 44px; }')
  })

  test('the two rules that had to stay unlayered still win', async () => {
    /*
     * Moving the block into a preflight puts it in @layer cw-base, and an
     * unlayered rule beats a layered one at any specificity. Two rules had a
     * competitor on the same element and would have silently stopped applying:
     *
     *   .tag-snoozed  lost `color` to the `tag` shortcut (var(--text-3))
     *   select.panel:hover  lost `border-color` to the `panel` shortcut
     *
     * The first is a shortcut with a bang; the second moved to the element as a
     * hover utility. Neither failure would have shown up as anything but a
     * slightly wrong colour, so they are asserted by effect.
     */
    const css = await dashboardCss()
    expect(css).toContain('.tag-snoozed')
    expect(css).toMatch(/\.tag-snoozed\s*\{[^}]*color:\s*var\(--text-2\)\s*!important/)
    expect(dashboard).toContain('hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--border))]')
    expect(css).toContain('border-color: color-mix(in srgb,var(--accent) 40%,var(--border))')
  })

  test('settings tabs scroll inside their own strip', () => {
    expect(settings).toContain('.tabnav { max-width: 100%; overflow-x: auto;')
    expect(settings).toContain('.tabnav a { flex: none;')
  })

  test('marketing menu is bounded by the visible mobile viewport', () => {
    expect(marketing).toContain('max-height: calc(100dvh - 92px); overflow-y: auto;')
    expect(marketing).toContain('overscroll-behavior: contain;')
    expect(marketing).toContain('body:has(.nav-menu[open]) { overflow: hidden; }')
  })
})
