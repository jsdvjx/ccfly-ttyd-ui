import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectBusy } from '../src/state/detectors/busy.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 模拟线上:ttyd/xterm 读屏时最后一行是 tmux 状态栏(fixture 不含它)。
const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

const POSITIVE = ['busy', 'subagent'] as const
const NEGATIVE = [
  'idle',
  'select',
  'usage',
  'cost',
  'help',
  'status',
  'offline',
  'context',
] as const

describe('detectBusy', () => {
  describe('正样本(生成中 / subagent)必须 true', () => {
    for (const name of POSITIVE) {
      it(`${name} -> true`, () => {
        expect(detectBusy(fx(name))).toBe(true)
      })
      it(`${name} + tmux 状态栏 -> 仍 true`, () => {
        expect(detectBusy(withTmuxBar(fx(name)))).toBe(true)
      })
    }
  })

  describe('负样本必须 false', () => {
    for (const name of NEGATIVE) {
      it(`${name} -> false`, () => {
        expect(detectBusy(fx(name))).toBe(false)
      })
      it(`${name} + tmux 状态栏 -> 仍 false`, () => {
        expect(detectBusy(withTmuxBar(fx(name)))).toBe(false)
      })
    }
  })

  it('空输入 -> false', () => {
    expect(detectBusy([])).toBe(false)
  })
})
