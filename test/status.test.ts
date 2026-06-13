import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectStatus } from '../src/state/detectors/status.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 模拟线上 app:经 ttyd/xterm 读屏时,最后一行会多出 tmux 状态栏。检测器必须扫
// 「末尾窗口」而非假设 footer 是最后一行 —— 用「带尾栏」变体一起验证它不被挤掉。
const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude*                          "host" 19:40 08-Jun-26',
]

const NEGATIVES = [
  'idle',
  'busy',
  'select',
  'usage',
  'cost',
  'help',
  'offline',
  'context',
  'subagent',
  'mcp', // 标题「Manage MCP servers」不得误判 status(已把 status 锚点收紧为「MCP servers:」)
  'plugin',
  'config',
  'stats_overview',
]

describe('detectStatus', () => {
  it('正样本 status → true', () => {
    expect(detectStatus(fx('status'))).toBe(true)
  })

  it('正样本 status(末尾追加 tmux 状态栏)→ 仍 true', () => {
    expect(detectStatus(withTmuxBar(fx('status')))).toBe(true)
  })

  for (const name of NEGATIVES) {
    it(`负样本 ${name} → false`, () => {
      expect(detectStatus(fx(name))).toBe(false)
    })

    it(`负样本 ${name}(末尾追加 tmux 状态栏)→ false`, () => {
      expect(detectStatus(withTmuxBar(fx(name)))).toBe(false)
    })
  }
})
