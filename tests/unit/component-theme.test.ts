import { describe, expect, test } from 'bun:test'
import theme from '../../config/crosswind'
// The installed STX package does not export these subpaths by bare specifier.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { SEMANTIC_TOKENS, SHAPE_TOKENS } from '../../node_modules/@stacksjs/stx/dist/theme-tokens.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const colors: Record<string, string> = theme.theme.extend.colors
const radii: Record<string, string> = theme.theme.extend.borderRadius

/*
 * The contract this app owes @stacksjs/components.
 *
 * Its components style themselves in role names (bg-field, bg-success-soft,
 * rounded-pill), which crosswind resolves as `var(--stx-<role>, <light value>)`
 * against its own :root/.dark defaults. This app themes with [data-theme] and
 * sets darkClass: null, so that .dark half NEVER matches: any role this palette
 * leaves unmapped keeps its LIGHT value in dark mode. Measured before this was
 * mapped: a #fff <DateRangePicker> trigger under #f3f5f9 text, 1.03:1.
 *
 * Asserting the WHOLE vocabulary rather than the roles in use today, because
 * "unmapped" looks fine until some component reaches for that role.
 */
describe('component palette contract', () => {
  test('maps every installed library color and shape role', () => {
    expect(Object.keys(SEMANTIC_TOKENS).filter(role => !colors[role])).toEqual([])
    expect(Object.keys(SHAPE_TOKENS).filter(role => !radii[role])).toEqual([])
  })

  test('the real STX/Crosswind merge emits app values, not stock role fallbacks', async () => {
    const engine = await loadCssEngine()
    if (!engine) throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    for (const role of Object.keys(SEMANTIC_TOKENS)) generator.generate(`bg-${role}`)
    for (const role of Object.keys(SHAPE_TOKENS)) generator.generate(`rounded-${role}`)
    const css = generator.toCSS(false, false)
    for (const role of Object.keys(SEMANTIC_TOKENS))
      expect(css).toContain(`.bg-${role} {\n  background-color: ${colors[role]};`)
    for (const role of Object.keys(SHAPE_TOKENS))
      expect(css).toContain(`.rounded-${role} {\n  border-radius: ${radii[role]};`)
    expect(css).not.toContain('var(--stx-')
  })

  test('no role reads a variable only marketing.css declares', () => {
    /*
     * --accent-soft is declared in public/marketing.css, which only the
     * marketing pages link. Pointing a role at it rendered <Badge
     * variant="primary"> with NO fill on a dashboard page, because
     * `background-color: var(--accent-soft)` is invalid at computed-value time
     * when the variable is absent. Roles must come from the palette in
     * config/crosswind.ts, which every page gets.
     */
    const marketingOnly = ['--accent-soft', '--accent-line', '--surface', '--surface-2']
    const offenders = Object.entries(colors)
      .filter(([, value]) => marketingOnly.some(v => value.includes(`var(${v})`)))
      .map(([role]) => role)
    expect(offenders).toEqual([])
  })

  test('this palette has two status hues, and says so deliberately', () => {
    expect(colors.success).toBe('var(--ok)')
    // --warn is named for the state, not the hue: it is this palette's red.
    expect(colors.danger).toBe('var(--warn)')
    // No amber, cyan or purple here, so these are a chosen neutral rather than
    // a stock light default that could never re-theme.
    for (const role of ['warning', 'info', 'secondary'])
      expect(colors[role]).toBe('var(--text-2)')
  })
})
