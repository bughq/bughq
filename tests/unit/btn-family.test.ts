/**
 * The `.btn` family, and why it was never four buttons.
 *
 * Five files declared a `.btn` in their own `<style>` block, most of it
 * `!important`, and that is what kept all five on tests/unit/hoisted-chrome's
 * blocked list: no single page could move while the others still declared the
 * same name differently.
 *
 * Measured declaration by declaration rather than argued:
 *
 *   settings.stx `.btn`, projects/index.stx `.btn`, account.stx `.btn`+`.btn-primary`
 *     -> one accent button. Same `var(--accent)` fill, same `var(--accent-ink)`
 *        ink, same 10px radius, same `color-mix(… 88%, #000)` on hover. Only
 *        the transition lists differed, and only because each copy named the
 *        properties its own page happened to animate.
 *
 *   issue/[id].stx `.btn`, AutofixPanel.stx `.autofix-card .btn`
 *     -> one panel-outline button, byte-identical apart from a
 *        `justify-content: center` on an inline-flex that sizes to its content.
 *
 * Two buttons, `btn-solid` and `btn-outline`, plus public/marketing.css's,
 * which keeps the bare `.btn` name because 24 marketing views use it.
 *
 * Everything here reads the GENERATED sheet through stx's own merge, not the
 * config object: a shortcut only reaches a page if the engine emits it, and the
 * ways it can quietly fail to -- an unknown theme key, a variant this version
 * cannot extract, a name the safelist does not carry -- all look like a correct
 * config and a blank button.
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
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const has = (css: string, needle: string) => flat(css).includes(flat(needle))

/** Generated exactly as the render path does it: safelist first, then markup. */
async function generate(markup = ''): Promise<string> {
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

describe('the two buttons', () => {
  test('btn-solid carries what the three accent copies agreed on', async () => {
    const css = await generate()
    const rules = [
      '.btn-solid { background-color: var(--accent); color: var(--accent-ink); border-radius: 10px !important;',
      'font-weight: 600;',
      'transition: transform 0.12s ease,opacity 0.15s ease,background-color 0.15s ease;',
      '.btn-solid:hover',
      'background-color: color-mix(in srgb,var(--accent) 88%,#000);',
      '.btn-solid:active { transform: translateY(1px); }',
      '.btn-solid:disabled { opacity: 0.6 !important; cursor: default; }',
    ]
    for (const rule of rules)
      expect({ rule, present: has(css, rule) }).toEqual({ rule, present: true })
  })

  test('btn-accent is btn-solid plus the auth form\'s size', async () => {
    /*
     * A shortcut may reference another shortcut -- the engine expands it before
     * generating. Checked here rather than assumed, because if it ever stopped
     * doing so `btn-accent` would silently become two padding utilities and the
     * six auth submit buttons would lose their fill entirely.
     */
    const css = await generate('<button class="btn-accent">Sign in</button>')
    expect(has(css, '.btn-accent { background-color: var(--accent); color: var(--accent-ink);')).toBe(true)
    expect(has(css, 'padding-top: 0.625rem !important;')).toBe(true)
    expect(has(css, 'font-size: 0.875rem !important;')).toBe(true)
    expect(has(css, '.btn-accent:hover')).toBe(true)
    expect(has(css, '.btn-accent:disabled { opacity: 0.6 !important; cursor: default; }')).toBe(true)
  })

  test('btn-outline carries what issue/[id] and AutofixPanel both declared', async () => {
    const css = await generate()
    const rule = '.btn-outline { display: inline-flex; align-items: center; justify-content: center;'
      + ' gap: 0.4rem !important; padding-left: 0.8rem !important; padding-right: 0.8rem !important;'
      + ' padding-top: 0.4rem !important; padding-bottom: 0.4rem !important; border-radius: 9px !important;'
      + ' font-size: 0.8rem !important; font-weight: 600; border-width: 1px; border-style: solid;'
      + ' border-color: var(--border); background-color: var(--panel); color: var(--text-2) !important;'
      + ' cursor: pointer;'
    expect(has(css, rule)).toBe(true)
    expect(has(css, '.btn-outline:hover { color: var(--text) !important;')).toBe(true)
    expect(has(css, '.btn-outline:active { transform: translateY(1px); }')).toBe(true)
  })

  test('the marks are on exactly the five properties <Button variant="ghost"> sets', () => {
    /*
     * gap, padding, radius, font-size and colour. Both the component's
     * utilities and a shortcut are single-class selectors, so specificity ties
     * and crosswind sorts its output by category rather than by generation
     * order -- without the marks the override is PARTIAL, which is worse than
     * none. Marked across the whole family, because an !important base
     * outranks its own un-marked :hover.
     */
    const shortcuts = (theme as { shortcuts: Record<string, string> }).shortcuts
    const marked = shortcuts['btn-outline'].split(/\s+/).filter(c => c.includes('!')).sort()
    expect(marked).toEqual([
      '!gap-[0.4rem]',
      '!px-[0.8rem]',
      '!py-[0.4rem]',
      '!rounded-[9px]',
      '!text-[0.8rem]',
      '!text-muted',
      'hover:!text-ink',
    ])
  })
})

describe('the fix that came with the move', () => {
  test('btn-autofix paints its CTA again', async () => {
    /*
     * It was a pageCss rule, and it had stopped working. A preflight lands in
     * `@layer tc-base`; `.autofix-card .btn` beside it was unlayered, and an
     * unlayered rule beats a layered one at ANY specificity -- so `color: #fff`
     * lost to `color: var(--text-2)` and the one call to action on the panel
     * rendered as a plain outline button. issue/[id].stx's `.btn` carried
     * `color: var(--text-2) !important` too, which made it certain.
     */
    const css = await generate()
    expect(has(css, '.btn-autofix { color: #fff !important;')).toBe(true)
    expect(has(css, 'background-color: color-mix(in srgb,var(--accent) 78%,#0b0f19) !important;')).toBe(true)
    expect(has(css, '.btn-autofix:hover')).toBe(true)
    // And it is no longer a layered rule that cannot win.
    const preflight = ((theme as { preflights?: { getCSS: () => string }[] }).preflights ?? [])
      .map(e => e.getCSS()).join('\n')
    expect(preflight).not.toContain('.btn-autofix')
  })

  test('the class the client computes is safelisted', () => {
    // AutofixPanel.stx builds `btn-outline btn-autofix` in a client function,
    // so neither name is in any rendered attribute on any page.
    const source = read('resources/components/AutofixPanel.stx')
    expect(source).toContain("'btn-outline btn-autofix'")
    const safelist = (theme as { safelist?: string[] }).safelist ?? []
    expect(safelist).toContain('btn-autofix')
    expect(safelist).toContain('btn-outline')
  })
})

describe('the extractor cannot reach these pages', () => {
  /*
   * /account, /projects, /settings and /issue/:id put their whole body behind
   * `@if (user …)`, so a build with no session renders a loading shell and the
   * real markup is never scanned. settings.stx recorded the symptom before the
   * cause was understood: `flex-none` and `whitespace-nowrap` sat on two of its
   * buttons and emitted no CSS at all.
   */
  test('the names this move introduced behind the gate are all safelisted', () => {
    /*
     * Deliberately a list and not a sweep. Whether a class is reachable is a
     * property of the RENDERED page, not of the source: account.stx's `.card`
     * sits outside its `@if (user …)` and is extracted, while the buttons
     * inside it are not, and no reading of the template text separates those
     * two reliably. Audited against the built site instead -- across all 33
     * pages, every shortcut appearing in rendered markup has a rule in that
     * page's sheet -- and the names below are the ones that only ever appear
     * after a session exists.
     */
    const safelist = new Set((theme as { safelist?: string[] }).safelist ?? [])
    for (const name of ['btn-solid', 'btn-outline', 'btn-autofix', 'icon-btn-lg', 'badge', 'badge-pro', 'avatar', 'row-rule', 'skeleton', 'active:translate-y-px'])
      expect(`${name}: ${safelist.has(name)}`).toBe(`${name}: true`)
  })

  test('a safelisted name is generated with no markup at all', async () => {
    // The mechanism itself, not just the list. If `safelist` ever stopped
    // surviving stx's config merge, every one of these would vanish together.
    const css = await generate()
    for (const name of (theme as { safelist?: string[] }).safelist ?? []) {
      const selector = `.${name.replace(/[:[\]().,%#]/g, '\\$&')}`
      expect({ name, generated: css.replace(/\\/g, '').includes(`.${name.replace(/\\/g, '')}`) || css.includes(selector) })
        .toEqual({ name, generated: true })
    }
  })
})

describe('the three views that came off the blocked list', () => {
  test('none of them declares CSS any more', () => {
    for (const path of [
      'resources/components/AutofixPanel.stx',
      'resources/views/account.stx',
      'resources/views/projects/index.stx',
    ]) {
      const src = read(path).replace(/\{\{--[\s\S]*?--\}\}/g, '')
      expect(`${path}: ${/^[ \t]*<style[ >]/m.test(src)}`).toBe(`${path}: false`)
    }
  })

  test('none of them asks for `btn` any more, and marketing.css still owns it', () => {
    for (const path of [
      'resources/components/AutofixPanel.stx',
      'resources/views/account.stx',
      'resources/views/projects/index.stx',
    ]) {
      const classes = [...read(path).matchAll(/class(?:Name)?="([^"]*)"/g)]
        .flatMap(m => m[1].split(/\s+/))
      for (const gone of ['btn', 'btn-primary'])
        expect(`${path}/${gone}: ${classes.includes(gone)}`).toBe(`${path}/${gone}: false`)
    }
    expect(read('public/marketing.css')).toMatch(/\.btn\b/)
  })

  test('projects/index keeps its deliberate 36px icon button', async () => {
    /*
     * Not drift: at 36px it matches the height of the "+ New app" button beside
     * it, where `icon-btn`'s 34 would sit 2px short. The block used to get
     * there by overriding all eleven of that shortcut's properties; the call
     * site names `icon-btn-lg` instead, so nothing is overridden at all.
     */
    expect(read('resources/views/projects/index.stx')).toContain('class="icon-btn-lg theme-btn"')
    const css = await generate()
    expect(has(css, '.icon-btn-lg { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px;')).toBe(true)
    expect(has(css, 'border-radius: 10px; color: var(--text-3);')).toBe(true)
    expect(has(css, '.icon-btn-lg svg { width: 18px; height: 18px; }')).toBe(true)
    // And the 34px one is untouched for the three pages that use it.
    expect(has(await generate('<button class="icon-btn"></button>'), '.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;')).toBe(true)
  })

  test('account.stx\'s surfaces generate what its block declared', async () => {
    const css = await generate()
    const rules = [
      '.badge { border-width: 1px; border-style: solid; border-color: var(--border); border-radius: 999px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-2); }',
      '.badge-pro { border-color: var(--accent); color: var(--accent); }',
      '.avatar { border-radius: 999px; object-fit: cover; background-color: color-mix(in srgb,var(--accent) 14%,var(--panel)); }',
      '.row-rule { border-top-width: 1px;',
      '.skeleton { background-color: color-mix(in srgb,var(--text-3) 20%,transparent); border-radius: 6px; animation: skeleton-pulse 1.4s ease-in-out infinite; }',
      '@keyframes skeleton-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }',
    ]
    for (const rule of rules)
      expect({ rule, present: has(css, rule) }).toEqual({ rule, present: true })
  })

  test('the keyframes are not called `pulse`', async () => {
    // This engine emits its own `@keyframes pulse` for `animate-pulse`, and
    // @keyframes obey the cascade, so sharing the name is a silent swap of one
    // animation for the other.
    const css = await generate('<div class="animate-pulse"></div>')
    expect(css).toContain('@keyframes pulse')
    expect(css).toContain('@keyframes skeleton-pulse')
    expect(has(css, 'animation: skeleton-pulse 1.4s')).toBe(true)
  })
})
