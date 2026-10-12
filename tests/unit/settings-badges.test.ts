import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import theme from '../../config/crosswind'
// The installed STX package does not export these subpaths by bare specifier.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { processDirectives } from '../../node_modules/@stacksjs/stx/dist/process.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

/*
 * The six status badges on /settings are <Badge> from @stacksjs/components.
 *
 * They used to be spans styled by a `.badge` rule in this view's own <style>
 * block, and that is the reason this suite exists rather than the tidiness.
 * The SPA router only removes the sheets it marked, so an unmarked page <style>
 * survives navigation; account.stx declares its OWN `.badge` with a different
 * body (bordered, mono, uppercase, no fill), so whichever of the two pages was
 * entered first decided what a badge looked like on the other. Moving one side
 * onto the component removes the collision outright.
 *
 * What the tests below actually guard:
 *   - the colours did not move. Every variant here was chosen to reproduce the
 *     rule it replaced, so the assertions name the computed value, not the role.
 *   - the type did not move. <Badge size="sm"> is 12px/500; these rows are
 *     11px/600 at 0.02em and `badge-hq` is the only thing holding that.
 *   - the two tooltips survive. <Badge> forwards `className` and nothing else,
 *     so a `title` passed to the component lands in data-stx-props and never
 *     reaches the DOM. That failure is invisible: the badge still renders.
 */

const root = resolve(import.meta.dir, '../..')
const library = resolve(root, 'node_modules/@stacksjs/components/src/ui')
const badgePath = resolve(library, 'badge/Badge.stx')
const settingsPath = resolve(root, 'resources/views/settings.stx')
const settingsSource = readFileSync(settingsPath, 'utf8')

async function renderSettings() {
  const template = settingsSource.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  const dependencies = new Set<string>()
  const rendered = await processDirectives(template, {
    user: { id: 1, email: 'owner@example.test' },
    projects: [{ id: 1, name: 'Demo' }],
    needsOnboarding: false,
    canInvite: true,
    activeProject: { name: 'Demo', is_active: true },
    guide: { label: 'Node.js', install: 'bun add @bughq/node' },
    ownerEmail: 'owner@example.test',
    memberView: [{ id: 'm1', email: 'member@example.test' }],
    inviteView: [
      { id: 'i1', email: 'bounced@example.test', note: 'Not delivered', failed: true, join: 'https://bughq.test/join/a' },
      { id: 'i2', email: 'waiting@example.test', note: 'Invited', failed: false, join: 'https://bughq.test/join/b' },
    ],
    channelView: [
      { id: 'c1', type: 'slack', label: 'Engineering', mask: 'https://hooks.slack…', enabled: true },
      { id: 'c2', type: 'discord', label: 'Ops', mask: 'https://discord…', enabled: false },
    ],
    // Button and EmptyState so the page renders whole; the badges are what is
    // asserted, but an unresolved tag leaves a comment where markup should be.
    __importedComponents: new Map([
      ['badge', badgePath],
      ['button', resolve(library, 'button/Button.stx')],
      ['empty-state', resolve(library, 'empty-state/EmptyState.stx')],
    ]),
  }, settingsPath, {
    componentsDir: resolve(root, 'resources/components'),
    partialsDir: resolve(root, 'resources/partials'),
  }, dependencies)

  const html = rendered.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
  expect(html).not.toContain('[Component Error')
  expect(html).not.toContain('[Foreach Error')
  expect(html).not.toContain('<Badge')
  return { html, dependencies }
}

// The badge whose text is `label`, as one flattened string.
function badgeFor(html: string, label: string): string {
  for (const match of html.matchAll(/<span[^>]*rounded-pill[\s\S]*?<\/span>/g)) {
    const flat = match[0].replace(/\s+/g, ' ')
    if (flat.includes(`> ${label} <`) || flat.includes(`>${label}<`))
      return flat
  }
  throw new Error(`no badge rendered for ${label}`)
}

describe('settings status badges', () => {
  test('all six render the library badge, none of them an app span', async () => {
    const { html, dependencies } = await renderSettings()
    expect([...dependencies]).toContain(badgePath)
    expect((html.match(/rounded-pill/g) || []).length).toBe(7)
    // The `.badge` class is gone from the markup as well as from the stylesheet.
    // `badge` on its own, not badge-hq or badge-slack: the hyphenated names are
    // the replacements, the bare one is what leaked.
    expect(html).not.toMatch(/class="[^"]*(?<![\w-])badge(?![\w-])[^"]*"/)
    for (const label of ['Node.js', 'Owner', 'Member', 'Undelivered', 'Invited', 'Slack', 'Discord'])
      expect(badgeFor(html, label)).toBeTruthy()
  })

  test('each badge keeps the fill its old rule gave it', async () => {
    const { html } = await renderSettings()
    // .badge-soft and .badge-owner were both an accent tint on panel.
    expect(badgeFor(html, 'Owner')).toContain('bg-accent-soft text-accent-soft-ink')
    expect(badgeFor(html, 'Member')).toContain('bg-accent-soft text-accent-soft-ink')
    expect(badgeFor(html, 'Node.js')).toContain('bg-accent-soft text-accent-soft-ink')
    // .badge-failed was --warn, which this palette maps to the danger role.
    expect(badgeFor(html, 'Undelivered')).toContain('bg-danger-soft text-danger-soft-ink')
    // .badge-pending was a neutral grey, which is `secondary` in this app.
    expect(badgeFor(html, 'Invited')).toContain('bg-secondary-soft text-secondary-soft-ink')
    // Brand fills override the default variant rather than naming a role.
    expect(badgeFor(html, 'Slack')).toContain('badge-slack')
    expect(badgeFor(html, 'Discord')).toContain('badge-discord')
  })

  test('every tooltip on a library component survives, which the component alone would not do', async () => {
    const { html } = await renderSettings()
    /*
     * A component forwards `className` and its own declared props. Everything
     * else -- title, id, data-*, aria-* it does not declare -- is recorded in
     * data-stx-props and never written to the element (stacksjs/stx#2063). The
     * failure is invisible, because the component still renders: four Buttons
     * on this page had been dropping their tooltips silently since they were
     * migrated. So each one sits on a wrapper, and these assertions are for the
     * wrapper rather than for the attribute.
     */
    const titles = [
      'The invite email was not delivered, but the join link still works if you share it',
      'Pending, and becomes a member once they accept',
      'Send the invite email again',
      'Revoke invite',
    ]
    for (const title of titles)
      expect(html).toContain(`<span class="inline-flex" title="${title}">`)

    // Nothing is passing a title INTO a component any more. The two that said
    // no more than their own label were dropped rather than wrapped.
    expect(html).not.toMatch(/data-stx-props="[^"]*title/)
  })

  test('this view no longer declares the badge rules that leaked between pages', () => {
    expect(settingsSource).not.toMatch(/^\.badge[ .:{]/m)
    expect(settingsSource).not.toMatch(/^\.badge-(slack|discord|soft|owner|pending|failed)\b/m)
    // account.stx is the other declaration, and it is now the only one.
    const account = readFileSync(resolve(root, 'resources/views/account.stx'), 'utf8')
    expect(account).toMatch(/^\.badge \{/m)
  })

  test('badge-hq reproduces the type the old .badge rule set', async () => {
    const engine = await loadCssEngine()
    if (!engine)
      throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    for (const name of ['badge-hq', 'badge-slack', 'badge-discord'])
      generator.generate(name)
    const css = generator.toCSS(false, false)

    // 11px/600/0.02em/9px, every one of them `!important`: the component sets
    // text-xs and font-medium as single-class utilities, so without `!` the
    // override lands only where crosswind happens to sort this shortcut later.
    expect(css).toContain('font-size: 11px !important;')
    expect(css).toContain('font-weight: 600 !important;')
    expect(css).toContain('letter-spacing: 0.02em !important;')
    expect(css).toContain('padding-left: 9px !important;')
    expect(css).toContain('padding-right: 9px !important;')
    expect(css).toContain('background-color: var(--slack) !important;')
    expect(css).toContain('background-color: var(--discord) !important;')
  })
})
