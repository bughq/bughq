/**
 * Shared chrome hoisted out of the page <style> blocks.
 *
 * The theme toggle's icon swap was declared identically in dashboard.stx,
 * settings.stx, issue/[id].stx and projects/index.stx; the wordmark link in
 * dashboard.stx and settings.stx. Sixteen rule instances, now two shortcuts.
 *
 * ONLY the byte-identical ones moved, and that boundary is what this file
 * guards. A shortcut is global the moment it exists, so hoisting a selector
 * that means different things on different pages is a behaviour change rather
 * than a refactor. `.btn`, `.card`, `.btn-ghost`, `.pill`, `.seg` and
 * `.btn:disabled` all still differ between the files that declare them, and
 * they stay page-scoped.
 *
 * That is safe because the router swaps them out: bughq's page <style> blocks
 * sit INSIDE <main>, which is the router's container, so a page's rules live
 * exactly as long as the page does. Measured rather than assumed, and it is
 * why these conflicts are not a leak and do not need renaming.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import theme from '../../config/crosswind'
// The installed STX package does not export these subpaths by bare specifier.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const ROOT = join(import.meta.dir, '../..')

function stxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory())
      out.push(...stxFiles(full))
    else if (entry.endsWith('.stx'))
      out.push(full)
  }
  return out
}

const views = stxFiles(join(ROOT, 'resources')).map(f => [f, readFileSync(f, 'utf8')] as const)

describe('hoisted shared chrome', () => {
  test('no view declares the hoisted rules any more', () => {
    for (const [file, source] of views) {
      expect(`${file}: ${/^\.theme-btn[\s[]/m.test(source)}`).toBe(`${file}: false`)
      expect(`${file}: ${/^\.wordmark-link[\s:{]/m.test(source)}`).toBe(`${file}: false`)
    }
  })

  test('the shortcuts emit exactly the rules that were removed', async () => {
    const engine = await loadCssEngine()
    if (!engine)
      throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    generator.generate('theme-btn')
    generator.generate('wordmark-link')
    const css = generator.toCSS(false, false).replace(/\s+/g, ' ')

    // The icon swap, which is the functional half: get these selectors wrong
    // and the toggle shows both icons or neither, on four pages.
    expect(css).toContain('.theme-btn .ic-sun { display: none; }')
    expect(css).toContain('.theme-btn .ic-moon { display: none; }')
    expect(css).toContain('.theme-btn[data-t="light"] .ic-sun { display: block; }')
    expect(css).toContain('.theme-btn[data-t="dark"] .ic-moon { display: block; }')

    expect(css).toContain('color: inherit;')
    expect(css).toContain('transition: opacity 0.15s ease;')
    expect(css).toContain('.wordmark-link:hover { opacity: 0.75; }')
  })

  test('the selectors that still differ per page are NOT hoisted', () => {
    /*
     * These are the ten the handoff wanted renamed. They are page-scoped on
     * purpose: `.btn` is a bordered ghost in settings and an accent fill in
     * projects/index, and a global shortcut would have to pick one. Listed
     * here so that making one of them global is a deliberate act with a failing
     * test attached, not a side effect of tidying.
     */
    const shortcuts = theme.shortcuts as Record<string, string>
    for (const name of ['btn', 'card', 'btn-ghost', 'pill', 'seg'])
      expect(`${name}: ${name in shortcuts}`).toBe(`${name}: false`)
  })

  test('the hoisted names are declared nowhere else', () => {
    // A shortcut collides with any same-named rule still living in a page
    // block or in marketing.css, which only the marketing pages link.
    const marketing = readFileSync(join(ROOT, 'public/marketing.css'), 'utf8')
    expect(marketing).not.toMatch(/\.theme-btn\b/)
    expect(marketing).not.toMatch(/\.wordmark-link\b/)
  })
})
