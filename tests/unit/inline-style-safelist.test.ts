/**
 * The utilities that replaced inline style attributes, and why they need the
 * safelist (stx-standards 11.5).
 *
 * Moving `style="opacity: .45"` to `class="opacity-45"` is only an improvement
 * if the class reaches the page. On four of these views it does not: /dashboard,
 * /issue/:id, /projects and /settings put their body behind `@if (user …)`, so a
 * build with no session renders a loading shell, Crosswind extracts from that
 * shell, and a class that only appears once somebody is signed in is never
 * generated. The inline declaration it replaced always applied, so the swap
 * would be a straight regression -- the silent kind, where the markup is right
 * and the stylesheet simply has no rule.
 *
 * Reachability was measured per page rather than assumed. account.stx is the
 * reason: its avatar and skeleton sit OUTSIDE its own `@if (user …)`, render in
 * the shell, and extract normally, so none of its names are listed here.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import theme from '../../config/crosswind'

const ROOT = join(import.meta.dir, '../..')
const read = (view: string) => readFileSync(join(ROOT, 'resources/views', view), 'utf8')

/** The names this move put behind the session gate, by the view they landed in. */
const BEHIND_THE_GATE: Record<string, string[]> = {
  'dashboard.stx': [
    '!border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]',
    '!bg-[color-mix(in_srgb,var(--accent)_6%,var(--panel))]',
    'tracking-[-0.01em]', 'opacity-[.35]', 'opacity-45', 'bg-[var(--border)]',
  ],
  'issue/[id].stx': [
    'max-w-[78rem]', 'text-[1.7rem]', 'leading-[1.15]', 'font-extrabold', 'tracking-[-0.01em]',
    'grid-cols-[minmax(0,1fr)]', '[grid-auto-rows:min-content]', 'justify-between',
    '!px-[.55rem]', '!py-1', 'border-b', 'border-line', 'p-2', '!border-[var(--border-2)]',
    'shadow-none', 'border-t', 'border-[var(--border-2)]', '!pt-[.6rem]', '!pb-[.2rem]', 'h-[.6rem]',
  ],
  'projects/index.stx': ['text-accent', 'bg-[color-mix(in_srgb,var(--accent)_14%,var(--panel))]'],
  'settings.stx': [
    'tracking-[-0.02em]', '[white-space:pre]', 'tracking-[0.01em]', 'text-[var(--warn)]',
    'border-t', 'border-line', 'bg-[color-mix(in_srgb,var(--text-3)_16%,var(--panel))]',
    'bg-[color-mix(in_srgb,var(--text-3)_12%,var(--panel))]', '!text-[var(--warn)]',
  ],
}

describe('utilities that replaced an inline style', () => {
  const safelist = new Set((theme as { safelist?: string[] }).safelist ?? [])

  test('every one behind the session gate is safelisted', () => {
    for (const names of Object.values(BEHIND_THE_GATE))
      for (const name of names)
        expect(`${name}: ${safelist.has(name)}`).toBe(`${name}: true`)
  })

  test('and each is still actually used by the view it was listed for', () => {
    // So the list cannot rot into a set of names nothing renders: a utility
    // dropped from a view should leave the safelist with it.
    for (const [view, names] of Object.entries(BEHIND_THE_GATE)) {
      const source = read(view)
      for (const name of names)
        expect(`${view} uses ${name}: ${source.includes(name)}`).toBe(`${view} uses ${name}: true`)
    }
  })

  test('no view carries a static style attribute any more', () => {
    // The sweep itself. validate-ui enforces this across the whole tree; this
    // pins the four views the safelist above exists for.
    for (const view of Object.keys(BEHIND_THE_GATE)) {
      const markup = read(view)
        .replace(/\{\{--[\s\S]*?--\}\}/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      const statics = [...markup.matchAll(/(?:^|[^:\w-])style="([^"]*)"/g)]
        .map(m => m[1])
        .filter(value => !value.includes('{{'))
      expect(`${view}: ${statics.join(' | ')}`).toBe(`${view}: `)
    }
  })
})
