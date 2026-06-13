import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectUsage } from '../src/state/detectors/usage.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

describe('detectUsage', () => {
  // /cost 与 /usage 是同一个面板,两份正样本都必须为 true。
  it.each(['usage', 'cost'])('positive: %s → true', (name) => {
    expect(detectUsage(fx(name))).toBe(true)
  })

  // 其余面板/状态都不应误判 —— 注意 idle/busy/select/help/status/context 里很多带有
  // tab 行的 "Usage" 字样或 /context 的 "Context Usage",检测器必须靠正文锚点把它们排除。
  it.each(['idle', 'busy', 'select', 'help', 'status', 'offline', 'context', 'subagent'])(
    'negative: %s → false',
    (name) => {
      expect(detectUsage(fx(name))).toBe(false)
    },
  )

  // 线上 ttyd/xterm 读屏时,末尾会粘一行 tmux 状态栏 —— footer 不是最后一行。
  // 检测器扫的是末尾窗口,所以即使尾部多出一行也要照样命中。
  it('still detects when a tmux status bar line is appended at the end', () => {
    const lines = [...fx('usage'), '[0] 0:claude* "host" 12:34 08-Jun-26']
    expect(detectUsage(lines)).toBe(true)
  })
})
