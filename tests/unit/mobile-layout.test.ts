import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../..')
const dashboard = readFileSync(join(ROOT, 'resources/views/dashboard.stx'), 'utf8')
const settings = readFileSync(join(ROOT, 'resources/views/settings.stx'), 'utf8')
const marketing = readFileSync(join(ROOT, 'public/marketing.css'), 'utf8')

describe('mobile layout contracts', () => {
  test('dashboard gives its toolbar and issue rows mobile layout hooks', () => {
    expect(dashboard).toContain('dashboard-appbar')
    expect(dashboard).toContain('dashboard-project-switcher')
    expect(dashboard).toContain('dashboard-stats')
    expect(dashboard).toContain('issue-rail')
    expect(dashboard).toContain('event-count')
  })

  test('dashboard switches to contained grids and touch-sized triage controls', () => {
    expect(dashboard).toContain('@media (max-width: 639px)')
    expect(dashboard).toContain('grid-template-columns: auto minmax(0, 1fr) auto;')
    expect(dashboard).toContain('grid-template-columns: 4px minmax(0, 1fr) auto;')
    expect(dashboard).toContain('.act { width: 44px; height: 44px; }')
  })

  test('settings tabs scroll inside their own strip', () => {
    expect(settings).toContain('.tabnav { max-width: 100%; overflow-x: auto;')
    expect(settings).toContain('.tabnav a { flex: none;')
  })

  test('marketing menu is bounded by the visible mobile viewport', () => {
    expect(marketing).toContain('max-height: calc(100dvh - 92px); overflow-y: auto;')
    expect(marketing).toContain('overscroll-behavior: contain;')
    expect(marketing).toContain('body:has(.nav-menu[open]) { overflow: hidden; }')
  })
})
