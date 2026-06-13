import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectMcp } from '../src/state/detectors/mcp.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

const POSITIVE = ['mcp'] as const
// status 含「MCP servers:」字段,是最关键的负样本(不能误判 mcp)。
const NEGATIVE = [
  'idle',
  'busy',
  'select',
  'usage',
  'help',
  'status',
  'config',
  'stats_overview',
  'plugin',
  'offline',
] as const

describe('detectMcp', () => {
  for (const name of POSITIVE) {
    it(`${name} -> true`, () => expect(detectMcp(fx(name))).toBe(true))
    it(`${name} + tmux 状态栏 -> 仍 true`, () =>
      expect(detectMcp(withTmuxBar(fx(name)))).toBe(true))
  }
  for (const name of NEGATIVE) {
    it(`${name} -> false`, () => expect(detectMcp(fx(name))).toBe(false))
  }
  it('空输入 -> false', () => expect(detectMcp([])).toBe(false))
})
