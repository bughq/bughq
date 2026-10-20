/**
 * settings.stx's chrome, after its 85-line `<style>` block moved.
 *
 * It was the largest block left in the app. The split is not a style
 * preference: a bag of properties on one class is a `shortcuts` entry, and a
 * pseudo-element, an attribute state or a compound selector is a `pageCss()`
 * rule, because no class on an element expresses those.
 *
 * Two of these could ONLY be shortcuts, and both for the same reason -- a
 * preflight lands in `@layer tc-base`, and an unlayered rule beats a layered
 * one at any specificity:
 *
 *   `field-quiet` overrides the `field` shortcut's focus ring. As a
 *     `.field:focus` preflight rule it would lose its border-color to
 *     `.field`'s own `border-line` and keep only the box-shadow, which is a
 *     bug this config has already had once and documented on `field`.
 *
 *   `danger-panel` sits on `class="danger-panel panel"`, and `panel` is a
 *     shortcut that sets `border-color`. Layered, the destructive section
 *     loses its warn-tinted border.
 *
 * Everything is read off the GENERATED sheet, through stx's own merge, for the
 * reason the dashboard assertions in mobile-layout.test.ts give: a rule can sit
 * in the config and still not reach the page.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import theme from '../../config/crosswind'
// The installed STX package does not export these subpaths by bare specifier.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const ROOT = join(import.meta.dir, '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const SRC = read('resources/views/settings.stx')
/**
 * The marketing sheet, read out of the MARKETING preflight. It was
 * public/marketing.css until it moved into config/crosswind.ts, scoped to the
 * marketing layout group (stx-standards rule 3, §11.2). Nesting did not
 * rewrite the rules, so every assertion below reads the same as it did.
 */
function marketingCss(): string {
  return ((theme as { preflights?: { getCSS: () => string }[] }).preflights ?? [])
    .map(entry => entry.getCSS())
    .find(css => css.includes('content="marketing"')) ?? ''
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const has = (css: string, needle: string) => flat(css).includes(flat(needle))

/** Safelist first, then the page's own classes -- the render path's order. */
async function generate(markup = SRC): Promise<string> {
  const engine = await loadCssEngine()
  if (!engine?.extractClasses)
    throw new Error('The installed STX CSS engine is required')
  const merged = mergeCssConfig(engine.defaultConfig || engine.config, theme)
  const generator = new engine.CSSGenerator(merged.config)
  for (const name of merged.safelist ?? [])
    generator.generate(name)
  for (const name of [...engine.extractClasses(markup)])
    generator.generate(name)
  return generator.toCSS(merged.includePreflight, false)
}

describe('the view declares no CSS', () => {
  test('no style block and no custom property', () => {
    const src = SRC.replace(/\{\{--[\s\S]*?--\}\}/g, '')
    expect(/^[ \t]*<style[ >]/m.test(src)).toBe(false)
    expect(/^\s*--[a-z0-9-]+\s*:/m.test(src)).toBe(false)
  })

  test('it no longer asks for `btn`, which the marketing sheet owns', () => {
    const classes = [...SRC.matchAll(/class(?:Name)?="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/))
    expect(classes).not.toContain('btn')
    expect(classes).toContain('btn-solid')
    expect(marketingCss()).toMatch(/\.btn\b/)
  })
})

describe('the rules that had to stay unlayered', () => {
  test('field-quiet beats the shared field focus ring', async () => {
    /*
     * Measured in a browser on the built site, not only here: with the input
     * really focused, border-color computes to the 55% accent mix and
     * box-shadow to none, where the `field` shortcut alone gives a full accent
     * border and a 3px glow.
     */
    const css = await generate()
    expect(has(css, '.field-quiet:focus { border-color: color-mix(in srgb,var(--accent) 55%,var(--border)) !important; box-shadow: none !important; }')).toBe(true)
    // Both rules are single-class + :focus, so specificity ties and the marks
    // are what decides -- not the order crosswind happens to emit them in.
    expect(has(css, '.field:focus { outline-style: none; border-color: var(--accent);')).toBe(true)

    // And every one of the seven inputs carries it (the sixth names an upload
    // token, the seventh shows a read key once when it is issued).
    const fields = [...SRC.matchAll(/class="([^"]*\bfield\b[^"]*)"/g)].map(m => m[1])
    expect(fields).toHaveLength(7)
    for (const site of fields)
      expect({ site, quiet: site.includes('field-quiet') }).toEqual({ site, quiet: true })
  })

  test('danger-panel beats the panel shortcut\'s border', async () => {
    const css = await generate()
    expect(has(css, '.danger-panel { border-color: color-mix(in srgb,var(--warn) 40%,var(--border)) !important; }')).toBe(true)
    expect(SRC).toContain('class="danger-panel panel"')
  })
})

describe('the structural rules, in pageCss', () => {
  test('each one survives the trip', async () => {
    const css = await generate()
    const rules = [
      // Pseudo-element knob, attribute state.
      '.tgl { width: 38px; height: 22px; border-radius: 999px; background: var(--border); position: relative;',
      '.tgl::after { content: \'\'; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;',
      '.tgl[data-on="1"] { background: var(--ok); }',
      '.tgl[data-on="1"]::after { transform: translateX(16px); }',
      // Brand fill keyed off the selected attribute.
      '.seg[data-sel="1"] { color: #fff; border-color: transparent; }',
      '.seg-slack[data-sel="1"] { background: var(--slack); }',
      '.seg-discord[data-sel="1"] { background: var(--discord); }',
      // Compound.
      '.note { display: none; }',
      '.note.show { display: block; }',
      // Pseudo-element + descendant.
      '.tabnav::-webkit-scrollbar { display: none; }',
      '.tabnav a { flex: none;',
      // Attribute + keyframes.
      '.dz-overlay[hidden] { display: none; }',
      '@keyframes dz-fade { from { opacity: 0 } to { opacity: 1 } }',
      '@keyframes dz-pop {',
    ]
    for (const rule of rules)
      expect({ rule, present: has(css, rule) }).toEqual({ rule, present: true })
  })

  test('smooth scrolling is scoped to the pages with the nav it is for', async () => {
    /*
     * The block declared a bare `html { scroll-behavior: smooth }`. A preflight
     * reaches all 33 pages, and /dashboard, /account, /projects and /issue/:id
     * never had it. The marketing sheet already sets it for the marketing
     * pages, so this only has to cover the one page with an in-page nav.
     */
    const css = await generate()
    expect(has(css, 'html:has(.tabnav) { scroll-behavior: smooth; }')).toBe(true)
    expect(css).not.toMatch(/(^|\n)\s*html\s*\{\s*scroll-behavior/)
  })
})

describe('the button family it carried', () => {
  test('btn-danger keeps its disabled state and the hover that restores it', async () => {
    /*
     * `.btn` has had a disabled state since the start and `.btn-danger` never
     * got one, while every `:disabled` binding in this file lands on a danger
     * button -- Rotate mid-rotation, each Remove mid-request, and the confirm
     * that stays inert until the typed phrase matches. The hover override
     * restores all three properties because `transition: all` means a partial
     * reset animates back to the danger fill.
     */
    const css = await generate()
    const rules = [
      '.btn-danger { border-width: 1px; border-style: solid; border-color: color-mix(in srgb,var(--warn) 45%,var(--border)); color: var(--warn) !important; border-radius: 10px !important; background-color: var(--panel); transition: all 0.15s ease; }',
      '.btn-danger:hover { color: #fff !important; background-color: var(--warn); border-color: var(--warn); }',
      '.btn-danger:disabled { opacity: 0.55 !important; cursor: default; }',
      '.btn-danger:disabled:hover { color: var(--warn) !important; background-color: var(--panel); border-color: color-mix(in srgb,var(--warn) 45%,var(--border)); }',
    ]
    for (const rule of rules)
      expect({ rule, present: has(css, rule) }).toEqual({ rule, present: true })
  })

  test('the three sizes emit what the block declared', async () => {
    const css = await generate()
    expect(has(css, '.btn-sm { padding-left: 0.75rem !important; padding-right: 0.75rem !important; padding-top: 0.5rem !important; padding-bottom: 0.5rem !important; font-size: 0.875rem !important; line-height: 1.25rem !important; font-weight: 500 !important; }')).toBe(true)
    expect(has(css, '.btn-xs { padding-left: 0.625rem !important;')).toBe(true)
    expect(has(css, '.btn-dz { flex: none; padding-left: 1rem !important;')).toBe(true)
    expect(has(css, 'white-space: nowrap;')).toBe(true)
  })

  test('flex-none and whitespace-nowrap actually ship now', () => {
    /*
     * The block recorded the symptom without naming the cause: those two sat as
     * utilities on these buttons and emitted no CSS at all, because the
     * extractor reads RENDERED pages and this one is behind an auth check.
     * `px-4` and `py-2.5` worked only because a public page happens to use
     * them. The answer is the safelist, not hand-written CSS.
     */
    const safelist = (theme as { safelist?: string[] }).safelist ?? []
    for (const name of ['btn-dz', 'btn-sm', 'btn-xs', 'btn-danger', 'field-quiet', 'danger-panel', 'code-block', 'copy-btn', 'dz-card', 'dz-div', 'sec', 'sec-title', 'note-ok', 'note-err', 'note-failed'])
      expect(`${name}: ${safelist.includes(name)}`).toBe(`${name}: true`)
  })
})
