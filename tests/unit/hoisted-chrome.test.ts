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
 * than a refactor. `.btn`, `.btn-ghost`, `.pill`, `.seg` and
 * `.btn:disabled` all still differ between the files that declare them, and
 * they stay page-scoped.
 *
 * That is safe because the router swaps them out: these page <style> blocks
 * sit INSIDE <main>, which is the router's container, so a page's rules live
 * exactly as long as the page does. Re-measured 2026-10-13 against the served
 * pages rather than the sources: account, projects/index, settings, dashboard
 * and both of issue/[id]'s blocks are inside the container, so their
 * collisions are confined to the page that declares them.
 *
 * pricing.stx was the exception and is the reason that sentence needs a date.
 * It pushed its block into <head>, where nothing removes it, so its `.card`
 * DID repaint other pages. Fixed by moving those eight rules out; see
 * tests/unit/head-style-leak.test.ts, which now keeps the <head> empty of
 * pushed styles so that the claim above stays true of the whole app.
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
    generator.generate('card')
    generator.generate('card-lift')
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

    // The three properties account.stx and issue/[id].stx each declared.
    expect(css).toContain('.card { background-color: var(--panel); border-width: 1px; '
      + 'border-style: solid; border-color: var(--border); border-radius: 14px; }')

    /*
     * card-lift's hover, asserted because it once failed silently. The obvious
     * spelling, `hover:[border-color:…]`, parsed and produced no rule at all,
     * so the tiles kept their transition and lost the border they transition
     * TO. Filed as stacksjs/ts-css#36, fixed in 0.3.14; this app resolves
     * 0.3.12 today, and `hover:border-[color-mix(…)]` is what the shortcut
     * uses either way.
     *
     * The assertion stays regardless of which spelling is in fashion. Only
     * /projects renders this, only when the account has an app, so nothing
     * public exercises it and a silent miss would surface as a reviewer
     * saying the hover feels broken rather than as a failure anywhere.
     */
    expect(css).toContain('.card-lift { transition: border-color 0.15s ease,transform 0.12s ease; }')
    expect(css).toContain('.card-lift:hover { border-color: color-mix(in srgb,var(--accent) 45%,var(--border)); '
      + 'transform: translateY(-1px); }')
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
    for (const name of ['btn', 'btn-ghost', 'pill', 'seg'])
      expect(`${name}: ${name in shortcuts}`).toBe(`${name}: false`)

    // `card` left this list once the three files that disagreed about it came
    // down to one meaning: account.stx and issue/[id].stx declared it
    // byte-identically, pricing.stx's `var(--surface)` / `var(--r)` version is
    // `card-tier`, and projects/index.stx's transition-only version is
    // `card-lift`. That is the shape the other four still need.
    expect(`card: ${'card' in shortcuts}`).toBe('card: true')
    for (const [file, source] of views)
      expect(`${file}: ${/^\.card[\s:{]/m.test(source)}`).toBe(`${file}: false`)
  })

  test('the hoisted names are declared nowhere else', () => {
    // A shortcut collides with any same-named rule still living in a page
    // block or in marketing.css, which only the marketing pages link.
    const marketing = readFileSync(join(ROOT, 'public/marketing.css'), 'utf8')
    expect(marketing).not.toMatch(/\.theme-btn\b/)
    expect(marketing).not.toMatch(/\.wordmark-link\b/)
  })
})
