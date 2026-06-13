import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectStats } from '../src/state/detectors/stats.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

// Stats 两个子页(Overview / Models)都必须判 true。
const POSITIVE = ['stats_overview', 'stats_models'] as const
const NEGATIVE = [
  'idle',
  'idle_typing',
  'busy',
  'subagent',
  'select',
  'usage',
  'cost',
  'help',
  'status',
  'config',
  'offline',
  'context',
] as const

describe('detectStats', () => {
  for (const name of POSITIVE) {
    it(`${name} -> true`, () => expect(detectStats(fx(name))).toBe(true))
    it(`${name} + tmux 状态栏 -> 仍 true`, () =>
      expect(detectStats(withTmuxBar(fx(name)))).toBe(true))
  }
  for (const name of NEGATIVE) {
    it(`${name} -> false`, () => expect(detectStats(fx(name))).toBe(false))
  }
  it('空输入 -> false', () => expect(detectStats([])).toBe(false))
})
