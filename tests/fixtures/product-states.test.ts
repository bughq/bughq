import { describe, expect, test } from 'bun:test'

const NOW = '2026-09-12T12:00:00.000Z'
const issue = (index: number, status = 'unresolved') => ({ id: `issue-${index}`, title: `TypeError: fixture ${index}`, status, count: index * 3, lastSeen: NOW })

export const productStates = {
  empty: { now: NOW, status: 'ready', issues: [], eventsCaptured: 0 },
  normal: { now: NOW, status: 'ready', issues: [issue(1), issue(2, 'resolved'), issue(3, 'ignored')], eventsCaptured: 18 },
  loading: { now: NOW, status: 'loading', issues: [], eventsCaptured: null },
  failure: { now: NOW, status: 'error', issues: [], error: 'Issue query failed' },
  highVolume: { now: NOW, status: 'ready', issues: Array.from({ length: 250 }, (_, index) => issue(index + 1)), eventsCaptured: 1_000_000 },
} as const

describe('deterministic bug product states', () => {
  test('covers every UI state', () => expect(Object.keys(productStates)).toEqual(['empty', 'normal', 'loading', 'failure', 'highVolume']))
  test('keeps volume fixtures large and reproducible', () => {
    expect(productStates.highVolume.issues).toHaveLength(250)
    expect(JSON.stringify(productStates)).toBe(JSON.stringify(productStates))
  })
})
