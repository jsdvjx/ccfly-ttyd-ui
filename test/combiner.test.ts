import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sessionStatus } from '../src/state/index.ts'
import type { Status, JEvent } from '../src/state/types.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 模拟线上:ttyd/xterm 读屏时最后一行是 tmux 状态栏(fixture 不含它)。
const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

// 每个 fixture 的预期顶层 status。
// idle/context → idle;busy/subagent → generating;cost → usage(同一面板)。
const CASES: Array<[string, Status]> = [
  ['idle', 'idle'],
  ['context', 'idle'],
  ['idle_typing', 'idle'], // 输入框有文字 → 仍 idle(回归:不能变 unknown)

  ['busy', 'generating'],
  ['subagent', 'generating'],
  ['select', 'select'],
  ['usage', 'usage'],
  ['cost', 'usage'],
  ['help', 'help'],
  ['status', 'status'],
  ['config', 'config'],
  ['stats_overview', 'stats'],
  ['stats_models', 'stats'],
  ['mcp', 'mcp'],
  ['plugin', 'plugin'],
  ['offline', 'offline'],
]

describe('sessionStatus(组合器)', () => {
  it('suggest 第三参透传(空时为 null)', () => {
    expect(sessionStatus([], fx('idle')).suggest).toBeNull()
    expect(sessionStatus([], fx('idle'), 'count files in my home dir').suggest).toBe(
      'count files in my home dir',
    )
  })

  for (const [name, expected] of CASES) {
    it(`${name} -> ${expected}`, () => {
      expect(sessionStatus([], fx(name)).status).toBe(expected)
    })
    it(`${name} + tmux 状态栏 -> 仍 ${expected}`, () => {
      expect(sessionStatus([], withTmuxBar(fx(name))).status).toBe(expected)
    })
  }

  it('认不出的 claude 屏 + 无 jsonl → unknown', () => {
    expect(sessionStatus([], ['random text', 'no chrome here']).status).toBe('unknown')
  })

  it('屏读不到/认不出 但有 jsonl 历史 → 退回 jsonl 推断(非 unknown)', () => {
    const idleEv: JEvent[] = [
      { type: 'assistant', message: { content: [{ type: 'text' }], stop_reason: 'end_turn' } },
    ]
    const genEv: JEvent[] = [{ type: 'user', message: { content: 'hi' } }]
    const toolEv: JEvent[] = [
      { type: 'assistant', message: { content: [{ type: 'tool_use' }], stop_reason: 'tool_use' } },
    ]
    expect(sessionStatus(idleEv, []).status).toBe('idle') // 空屏(终端没连)
    expect(sessionStatus(genEv, []).status).toBe('generating')
    expect(sessionStatus(toolEv, []).status).toBe('awaiting-tool')
    expect(sessionStatus(idleEv, ['random text']).status).toBe('idle') // 屏认不出也退回 jsonl
    expect(sessionStatus([], []).status).toBe('unknown') // 无屏无 jsonl → 仍 unknown
  })

  it('busy 屏:jsonl 细分 awaiting-tool vs generating', () => {
    const toolUse: JEvent[] = [
      { type: 'assistant', message: { content: [{ type: 'tool_use' }], stop_reason: 'tool_use' } },
    ]
    const gen: JEvent[] = [{ type: 'user', message: { content: 'hi' } }]
    expect(sessionStatus(toolUse, fx('busy')).status).toBe('awaiting-tool')
    expect(sessionStatus(gen, fx('busy')).status).toBe('generating')
  })

  it('jsonl 元数据透传到 SessionState', () => {
    const ev: JEvent[] = [
      { type: 'mode', mode: 'auto' },
      { type: 'permission-mode', permissionMode: 'plan' },
      { type: 'ai-title', aiTitle: 'My Task' },
      { type: 'system', pendingWorkflowCount: 2, pendingBackgroundAgentCount: 1 },
    ]
    const st = sessionStatus(ev, fx('idle'))
    expect(st.mode).toBe('auto')
    expect(st.permissionMode).toBe('plan')
    expect(st.title).toBe('My Task')
    expect(st.pendingWorkflows).toBe(2)
    expect(st.pendingAgents).toBe(1)
  })
})
