/**
 * The inline form notice: the error banner above a form, and the confirmation
 * that replaces it.
 *
 * Eight sites across the five auth-shaped views spelled `px-3 text-sm
 * rounded-lg` out as three separate utilities, identically in every one. They
 * carry `notice-box` now, composed with the colour class (`err` / `ok`, from
 * the preflight) and the vertical padding, which genuinely varies.
 *
 * Why this is a test and not just a config entry: a shortcut reaches the page
 * only through the Crosswind merge. Rename or drop the entry and every one of
 * these banners loses its padding, its type size and its corners while keeping
 * its red tint, and nothing else fails. So the assertions are on the GENERATED
 * declarations, driven from markup through the engine's own extractor, which is
 * the path `buddy serve` takes per request.
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

const CALLERS = [
  'resources/views/login.stx',
  'resources/views/register.stx',
  'resources/views/reset-password.stx',
  'resources/views/forgot-password.stx',
  'resources/views/projects/new.stx',
]

describe('the shared inline form notice', () => {
  test('every caller uses the shortcut and none spells the utilities out', () => {
    let total = 0
    for (const path of CALLERS) {
      const source = read(path)
      total += (source.match(/\bnotice-box\b/g) ?? []).length
      expect(source).not.toContain('px-3 py-2 text-sm rounded-lg')
      expect(source).not.toContain('px-3 py-3 text-sm rounded-lg')
    }
    expect(total).toBe(8)
  })

  test('the colour and the vertical padding stay at the call site', () => {
    /*
     * notice-box is geometry only. `.err` and `.ok` are declared in the preflight and
     * carry the tint, so a notice that lost its colour class would be a plain
     * grey box; and errors sit at py-2 while confirmations sit at py-3, which
     * is a real axis rather than something to fold in.
     */
    for (const path of CALLERS) {
      for (const match of read(path).matchAll(/class="([^"]*\bnotice-box\b[^"]*)"/g)) {
        expect(match[1]).toMatch(/\bpy-[23]\b/)
        expect(match[1]).toMatch(/\b(err|ok)\b/)
      }
    }
  })

  test('the generated rule is the three declarations the call sites carried', async () => {
    const engine = await loadCssEngine()
    if (!engine)
      throw new Error('The installed STX CSS engine is required')
    const config = mergeCssConfig(engine.defaultConfig || engine.config, theme).config

    const extract = engine.extractClasses
    if (!extract)
      throw new Error('The installed STX CSS engine is required')
    const extracted = [...extract('<div class="mb-4 py-2 notice-box err">x</div>')]
    expect(extracted).toContain('notice-box')

    const generator = new engine.CSSGenerator(config)
    for (const name of extracted)
      generator.generate(name)
    const css = generator.toCSS(false, false)

    expect(css).toContain('.notice-box {')
    // px-3
    expect(css).toContain('padding-left: 0.75rem;')
    expect(css).toContain('padding-right: 0.75rem;')
    // text-sm, both halves: a hand-written composite loses the line-height
    expect(css).toContain('font-size: 0.875rem;')
    expect(css).toContain('line-height: 1.25rem;')
    // rounded-lg
    expect(css).toContain('border-radius: 0.5rem;')
    // and NOT the colour, which belongs to .err / .ok
    expect(css).not.toMatch(/\.notice-box \{[^}]*background/)
  })
})
