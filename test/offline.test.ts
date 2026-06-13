import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectOffline } from '../src/state/detectors/offline.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// claude 屏清单 —— 全部必须判 false(offline 只在真正落回 shell 时为 true)。
const claudeScreens = [
  'idle',
  'busy',
  'select',
  'usage',
  'cost',
  'help',
  'status',
  'context',
  'subagent',
]

describe('detectOffline', () => {
  it('offline 正样本(落回 shell)→ true', () => {
    expect(detectOffline(fx('offline'))).toBe(true)
  })

  it('末行是 tmux 状态栏时仍判 true(扫末尾窗口,不假设证据在最后一行)', () => {
    const withStatusBar = [
      ...fx('offline'),
      '[ttyd] 0:zsh*  "MacBook" 16:47 08-Jun-26', // 模拟 tmux 状态栏那一行
    ]
    expect(detectOffline(withStatusBar)).toBe(true)
  })

  for (const name of claudeScreens) {
    it(`claude 屏 ${name} → false`, () => {
      expect(detectOffline(fx(name))).toBe(false)
    })

    it(`claude 屏 ${name} 末尾加 tmux 状态栏后仍 → false`, () => {
      const withStatusBar = [...fx(name), '[ttyd] 0:claude*  "MacBook" 16:47 08-Jun-26']
      expect(detectOffline(withStatusBar)).toBe(false)
    })
  }

  it('空屏 / 全空白 → false(宁可漏判也别误判)', () => {
    expect(detectOffline([])).toBe(false)
    expect(detectOffline(['', '   ', ''])).toBe(false)
  })
})
