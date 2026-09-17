import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../..')
const component = readFileSync(join(ROOT, 'resources/components/DateRangePicker.stx'), 'utf8')
const dashboard = readFileSync(join(ROOT, 'resources/views/dashboard.stx'), 'utf8')

const pureSlice = component.match(/\/\/ #region pure\n([\s\S]*?)\n\/\/ #endregion pure/)?.[1] ?? ''
// The shipped functions are typed (bughq runs stx typecheck); strip the types
// with Bun's transpiler so this evaluates the exact runtime code.
const pureJs = new Bun.Transpiler({ loader: 'ts' }).transformSync(pureSlice)
const pure = new Function(`${pureJs}\nreturn { pickGrid, pickShift, pickPreset, pickQuery }`)() as Record<string, (...a: any[]) => any>

describe('bughq dashboard date picker: math + presets', () => {
  test('grid, leap Feb, future flag', () => {
    expect(pure.pickGrid('2026-06', '2026-09-16')).toHaveLength(42)
    expect(pure.pickGrid('2028-02', '2028-09-16').filter((c: any) => c.inMonth)).toHaveLength(29)
    expect(pure.pickGrid('2026-09', '2026-09-16').find((c: any) => c.ymd === '2026-09-17').future).toBe(true)
  })
  test('day shifts survive DST and year ends', () => {
    expect(pure.pickShift('2026-03-08', 1)).toBe('2026-03-09')
    expect(pure.pickShift('2026-01-01', -1)).toBe('2025-12-31')
  })
  test('bughq native windows (incl. all) go out as ?range=, and it offers no 1y', () => {
    for (const key of ['24h', '7d', '30d', '90d', 'all'])
      expect(pure.pickPreset(key, '2026-09-16')).toEqual({ range: key })
    expect(pure.pickPreset('1y', '2026-09-16')).toBeNull()
    expect(component).toContain("pickApply('all')")
    expect(component).toContain("pickApply('90d')")
  })
  test('calendar presets resolve to local day bounds', () => {
    expect(pure.pickPreset('today', '2026-09-16')).toEqual({ from: '2026-09-16', to: '2026-09-16' })
    expect(pure.pickPreset('last-month', '2026-09-16')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })
})

describe('bughq dashboard date picker: URL preserves status, resets page', () => {
  test('a custom window keeps status, drops range and page', () => {
    const next = new URLSearchParams(pure.pickQuery('?status=resolved&range=7d&page=4', { from: '2026-09-01', to: '2026-09-16' }))
    expect(next.get('status')).toBe('resolved')
    expect(next.get('from')).toBe('2026-09-01')
    expect(next.has('range')).toBe(false)
    expect(next.has('page')).toBe(false)
  })
})

describe('bughq dashboard date picker: server wiring', () => {
  test('the view mounts the picker and parses a custom window', () => {
    expect(dashboard).toContain('<DateRangePicker :summary="rangeLabel" :active="isCustom" />')
    expect(dashboard).toContain('const isCustom = isDay(qFrom) && isDay(qTo)')
  })
  test('both queries bound last_seen by parameters, never interpolating from/to', () => {
    // list query: aliased column, parameterized
    expect(dashboard).toContain('conds.push(`i.last_seen::timestamptz >= $${params.length}`)')
    // count query: unaliased column (FROM issues has no alias) + its own params
    expect(dashboard).toContain('cconds.push(`last_seen::timestamptz >= $${cparams.length}`)')
    expect(dashboard).toContain('cparams,')
    // the customFrom/customTo never appear inside a template-literal SQL fragment
    expect(dashboard).not.toMatch(/INTERVAL '\$\{customFrom/)
  })
  test('pageUrl carries from/to, and the range pills clear them', () => {
    expect(dashboard).toContain('from: customFrom, to: customTo')
    expect(dashboard).toContain("pageUrl({ range: r.key, page: 1, from: '', to: '' })")
  })
})
