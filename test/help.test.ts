import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectHelp } from '../src/state/detectors/help.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 线上经 ttyd/xterm 读屏时,最后一行会是 tmux 状态栏 —— 检测器不能假设 footer 是最后一行。
// 模拟这种情况:在 fixture 末尾追加一行 tmux 状态栏,帮助面板仍应被识别。
const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:zsh*                          "host" 19:40 08-Jun-26',
]

describe('detectHelp', () => {
  it('帮助面板(help)→ true', () => {
    expect(detectHelp(fx('help'))).toBe(true)
  })

  it('帮助面板末尾被 tmux 状态栏顶上去时仍 → true', () => {
    expect(detectHelp(withTmuxBar(fx('help')))).toBe(true)
  })

  const negatives = [
    'idle',
    'busy',
    'select',
    'usage',
    'cost',
    'status',
    'offline',
    'context',
    'subagent',
  ]

  for (const name of negatives) {
    it(`${name} → false`, () => {
      expect(detectHelp(fx(name))).toBe(false)
    })
    it(`${name} + tmux 状态栏 → false`, () => {
      expect(detectHelp(withTmuxBar(fx(name)))).toBe(false)
    })
  }
})
