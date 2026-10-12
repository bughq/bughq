/**
 * No view may push a <style> into the <head>.
 *
 * The SPA router removes `style[data-crosswind]` and `style[data-stx-page]`
 * and nothing else (stx-router/dist/client.js:418). bughq's page <style>
 * blocks are written into the view body, so the layout wraps them in <main>,
 * which is the router's container -- those live exactly as long as the page
 * does. A block pushed with `@push('styles')` does not: layouts/marketing.stx
 * renders that stack inside <head>, outside the container, so it survives
 * every navigation for the rest of the session.
 *
 * pricing.stx was the one view doing it, and the cost was not theoretical.
 * Measured 2026-10-13 on the served pages: of the seven views still carrying a
 * <style> block, its 690-char block was the only one outside <main>. Entering
 * on /pricing and clicking into the app left `.card { background:
 * var(--surface); border-radius: var(--r) }` live, repainting every `.card` on
 * /account and /issue/:id, which mean a panel at 14px. Its `.seg`,
 * `.btn:disabled` and `.err` collided with settings.stx and the `.err`
 * preflight the same way.
 *
 * That is why the six remaining <style> blocks are allowed to keep colliding
 * class names and this one was not: the collision only matters when the block
 * outlives its page. This test keeps that distinction enforced rather than
 * remembered.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

const views = stxFiles(join(ROOT, 'resources')).map(f => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const)

describe('head style leak', () => {
  test('the marketing layout still renders the styles stack in <head>', () => {
    // The premise of the test below. If this stack ever moves inside <main>,
    // a pushed block stops leaking and this file is obsolete.
    const layout = readFileSync(join(ROOT, 'resources/views/layouts/marketing.stx'), 'utf8')
    const head = layout.slice(layout.indexOf('<head'), layout.indexOf('</head>'))
    expect(head).toContain('@stack(\'styles\')')
  })

  test('no view pushes a <style> into the styles stack', () => {
    for (const [file, source] of views) {
      for (const match of source.matchAll(/@push\(['"]styles['"]\)([\s\S]*?)@endpush/g))
        expect(`${file}: ${/<style/.test(match[1])}`).toBe(`${file}: false`)
    }
  })

  test('pricing.stx carries no <style> block at all', () => {
    // The eight rules became `card-tier` / `card-tier-pro` in config/crosswind.ts
    // and utilities at the call sites. Named rather than folded into the loop
    // above so that re-adding one to this file in particular fails loudly.
    const pricing = views.find(([f]) => f.endsWith('views/pricing.stx'))
    expect(pricing).toBeDefined()
    expect(pricing![1]).not.toContain('<style')
  })
})
