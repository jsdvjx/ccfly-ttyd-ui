import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectIdle } from '../src/state/detectors/idle.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 模拟线上:ttyd/xterm 读屏时最后一行是 tmux 状态栏(fixture 不含它)。
const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

// idle/context 是空闲帧;idle_typing 是「输入框里有文字」帧(footer 的 ← for agents 已消失,
// 只剩 shift+tab to cycle)——它也必须判 idle,这是「打字变 unknown」回归用例。
const POSITIVE = ['idle', 'context', 'idle_typing'] as const
const NEGATIVE = [
  'busy',
  'select',
  'usage',
  'cost',
  'help',
  'status',
  'offline',
  'subagent',
] as const

describe('detectIdle', () => {
  describe('正样本(空闲输入框)必须 true', () => {
    for (const name of POSITIVE) {
      it(`${name} -> true`, () => {
        expect(detectIdle(fx(name))).toBe(true)
      })
      it(`${name} + tmux 状态栏 -> 仍 true`, () => {
        expect(detectIdle(withTmuxBar(fx(name)))).toBe(true)
      })
    }
  })

  describe('负样本必须 false', () => {
    for (const name of NEGATIVE) {
      it(`${name} -> false`, () => {
        expect(detectIdle(fx(name))).toBe(false)
      })
      it(`${name} + tmux 状态栏 -> 仍 false`, () => {
        expect(detectIdle(withTmuxBar(fx(name)))).toBe(false)
      })
    }
  })

  it('空输入 -> false', () => {
    expect(detectIdle([])).toBe(false)
  })
})
