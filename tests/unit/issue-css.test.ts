/**
 * /issue/:id's chrome, after the last `<style>` block in the app moved.
 *
 * Two blocks, 114 lines, and the one thing in this repo stx-standards §11.2
 * names by example: a second `:root` palette, so `--bg` meant one colour on
 * /dashboard and another here.
 *
 * Almost none of the rest could become a class on an element. `.pill.lvl-fatal`
 * and `.frame.is-crash .fr-loc` are compounds, `details.sysgroup > summary
 * ::-webkit-details-marker` has no utility form, `.exc + .exc` and
 * `.crumb:first-child` are positional -- and the level and status names are
 * INTERPOLATED into the class attribute, so an extractor only ever sees
 * whichever one issue happened to render. A preflight always ships, which is
 * the whole answer for this page.
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
const SRC = read('resources/views/issue/[id].stx')
const PREFLIGHT = ((theme as { preflights?: { getCSS: () => string }[] }).preflights ?? [])
  .map(e => e.getCSS()).join('\n')
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const has = (css: string, needle: string) => flat(css).includes(flat(needle))

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

describe('the second palette is gone', () => {
  test('the view declares no custom property and no style block', () => {
    const src = SRC.replace(/\{\{--[\s\S]*?--\}\}/g, '')
    expect(/^[ \t]*<style[ >]/m.test(src)).toBe(false)
    expect(/--[a-z0-9-]+\s*:/.test(src)).toBe(false)
  })

  test('§11.2\'s own check passes across resources/', () => {
    // "Any CSS custom property declared outside config/crosswind.ts is a
    // violation." The standard quotes 101 for this app.
    const { globSync } = require('node:fs') as { globSync: (p: string, o: { cwd: string }) => string[] }
    const offenders = globSync('resources/**/*.stx', { cwd: ROOT })
      .filter(p => /--[a-z0-9-]+\s*:/.test(read(p).replace(/\{\{--[\s\S]*?--\}\}/g, '')))
    expect(offenders).toEqual([])
  })

  test('the six tokens only this page declared are in the shared palette', async () => {
    /*
     * Two of them were already being read by the Autofix rules in pageCss()
     * and worked only because that panel renders on the one page that happened
     * to declare them.
     */
    const css = await generate()
    for (const token of ['--panel-2', '--border-2', '--code', '--code-bg', '--app-tint', '--app-bar'])
      expect({ token, declared: css.includes(`${token}:`) }).toEqual({ token, declared: true })
    expect(has(css, '--panel-2: #fbfcfd')).toBe(true)
    expect(has(css, '--panel-2: #0e111a')).toBe(true)
    expect(PREFLIGHT).toContain('var(--border-2)')
  })

  test('the page font is preserved rather than unified, as a token', async () => {
    /*
     * This page has always used a system stack instead of --sans and nothing
     * records why, so the move keeps it. It is a token and not a literal
     * because this engine rewrites a `font-family` in a preflight when the
     * rule is written SPACED -- `sel { prop: value; }` -- and the stack starts
     * with `ui-sans-serif`, substituting the theme's own sans. Quoting is not
     * the trigger; the tight form `sel{prop:value}` is untouched, and so is
     * anything behind var(). Every rule in this config is written spaced.
     */
    const css = await generate()
    expect(has(css, 'body:has(.issue-root) { font-family: var(--sans-system); }')).toBe(true)
    expect(has(css, "--sans-system: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif")).toBe(true)
    // And the hook is on the page's OUTERMOST element, so `:has()` settles
    // before any of its content paints.
    const firstTag = /@section\('content'\)|<div class="[^"]*"/.exec(SRC.slice(SRC.indexOf('--}}')))
    expect(SRC).toMatch(/<div class="[^"]*\bissue-root\b[^"]*">/)
    expect(firstTag).not.toBeNull()
  })

  test('the engine really does rewrite a literal sans font-family in a preflight', async () => {
    // The measurement the decision above rests on, so a later engine version
    // that stops doing it is a visible failure rather than a stale comment.
    const engine = await loadCssEngine()
    if (!engine)
      throw new Error('The installed STX CSS engine is required')
    const probe = (decl: string) => {
      const merged = mergeCssConfig(engine.defaultConfig || engine.config, { ...theme, preflights: [{ getCSS: () => `.probe { ${decl} }` }] })
      return /\.probe \{[^}]*\}/.exec(new engine.CSSGenerator(merged.config).toCSS(true, false))?.[0] ?? ''
    }
    // Spaced + leading ui-sans-serif: substituted.
    expect(probe("font-family: ui-sans-serif, system-ui, 'Segoe UI', sans-serif;")).toContain('Space Grotesk')
    // The three things that are NOT the trigger, so a future reader does not
    // go looking for the wrong one: quoting, the tight form, a different stack.
    expect(probe('font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;')).toContain('Space Grotesk')
    expect(probe('font-family: Georgia, sans-serif;')).toContain('Georgia, sans-serif')
    expect(probe("font-family: 'JetBrains Mono', ui-monospace, monospace;")).toContain('JetBrains Mono')
    // And the fix.
    expect(probe('font-family: var(--sans-system);')).toContain('var(--sans-system)')
  })
})

describe('the rules that had to stay raw CSS', () => {
  test('every shape no utility can spell is in the preflight', async () => {
    const css = await generate()
    const rules = [
      // Compounds: the level and status chips.
      '.pill.lvl-fatal { background:#dc2626;',
      '.pill.st-unresolved { color:var(--accent);',
      // Positional.
      '.exc + .exc { margin-top: .75rem; }',
      '.crumb:first-child { border-top:none; }',
      '.frame + .frame { margin-top:1px; }',
      // A compound inside a descendant.
      '.frame.is-crash .fr-base { color: var(--accent); }',
      '.frame.is-crash .fr-loc {',
      // No utility form at all.
      'details.sysgroup > summary::-webkit-details-marker { display:none; }',
      'details.sysgroup[open] > summary .chev { transform: rotate(90deg); }',
      // Element descendants of a class.
      '.kv dt {',
      '.kv dd {',
    ]
    for (const rule of rules)
      expect({ rule, present: has(css, rule) }).toEqual({ rule, present: true })
  })

  test('the chip names are interpolated, which is why they cannot be shortcuts', () => {
    // `pill lvl lvl-{{ issue.level || 'error' }}` -- the extractor sees one
    // level per render at best, and this page is never rendered without a
    // session at all.
    expect(SRC).toMatch(/class="pill lvl lvl-\{\{/)
    expect(SRC).toMatch(/class="pill st-\{\{/)
  })
})

describe('the buttons compose the shared one', () => {
  test('btn-resolve and btn-copy are whole buttons, not modifiers', async () => {
    /*
     * As a modifier, `.btn-resolve`'s green would have to beat `btn-outline`'s
     * own `!text-muted` at equal specificity, where the winner is whichever
     * crosswind emitted last -- and pickier's class sorter is entitled to
     * rewrite the attribute order that decides it. Composed, there is one rule
     * and one colour in it.
     */
    const css = await generate()
    expect(has(css, '.btn-resolve { display: inline-flex;')).toBe(true)
    expect(has(css, 'border-color: rgba(34,197,94,.4); background-color: var(--panel); color: #16a34a !important;')).toBe(true)
    expect(has(css, '.btn-resolve:hover { color: #16a34a !important; border-color: rgba(34,197,94,.75); background-color: rgba(34,197,94,.1); }')).toBe(true)
    expect(has(css, '.btn-copy { display: inline-flex;')).toBe(true)
    expect(has(css, 'font-size: 0.68rem !important;')).toBe(true)
    expect(has(css, 'font-family: var(--mono);')).toBe(true)

    for (const site of SRC.match(/class(?:Name)?="[^"]*btn-(?:resolve|copy)[^"]*"/g) ?? [])
      expect({ site, pairedWithOutline: site.includes('btn-outline') }).toEqual({ site, pairedWithOutline: false })
  })

  test('the two-column grid is a utility, exactly on the old breakpoint', async () => {
    // The second block was one rule: `@media (min-width: 1024px)`, which is
    // what `lg:` already means.
    expect(SRC).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]')
    expect(SRC).not.toContain('bughq-cols')
    const css = await generate()
    expect(css).toContain('@media (min-width: 1024px)')
    expect(has(css, 'grid-template-columns: minmax(0,1fr) 20rem;')).toBe(true)
  })
})
