import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectPlugin } from '../src/state/detectors/plugin.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

const POSITIVE = ['plugin'] as const
// config 也有搜索框(Search settings),是关键负样本(plugin 是 Search…,不同)。
const NEGATIVE = [
  'idle',
  'busy',
  'select',
  'usage',
  'help',
  'status',
  'config',
  'stats_overview',
  'mcp',
  'offline',
] as const

describe('detectPlugin', () => {
  for (const name of POSITIVE) {
    it(`${name} -> true`, () => expect(detectPlugin(fx(name))).toBe(true))
    it(`${name} + tmux 状态栏 -> 仍 true`, () =>
      expect(detectPlugin(withTmuxBar(fx(name)))).toBe(true))
  }
  for (const name of NEGATIVE) {
    it(`${name} -> false`, () => expect(detectPlugin(fx(name))).toBe(false))
  }
  it('空输入 -> false', () => expect(detectPlugin([])).toBe(false))
})
