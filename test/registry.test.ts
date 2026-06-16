import { describe, it, expect } from 'vitest'
import { SCREEN_RULES } from '../src/state/registry.ts'
import type { Status } from '../src/state/types.ts'

// 守卫:防止未来某行偷优先级,或冒出第二个 'generating' / 第二个 refine 生产者。
describe('SCREEN_RULES registry', () => {
  const ordered = [...SCREEN_RULES].sort((a, b) => b.weight - a.weight)

  it('weights are strictly descending and distinct in the picker order', () => {
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].weight).toBeLessThan(ordered[i - 1].weight)
    }
  })

  it('status sequence matches the legacy source order', () => {
    const expected: Status[] = [
      'select',
      'usage',
      'help',
      'status',
      'config',
      'stats',
      'mcp',
      'plugin',
      'generating',
      'idle',
      'offline',
    ]
    expect(ordered.map((r) => r.status)).toEqual(expected)
  })

  it('only the busy/generating row carries a refine', () => {
    const refiners = ordered.filter((r) => r.refine)
    expect(refiners).toHaveLength(1)
    expect(refiners[0].status).toBe('generating')
  })
})
