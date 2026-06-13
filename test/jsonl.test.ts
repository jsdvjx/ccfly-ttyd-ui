import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  detectTurn,
  detectMode,
  detectPermissionMode,
  detectTitle,
  detectInterrupted,
  detectApiError,
  detectPending,
  detectLastActivity,
} from '../src/state/detectors/jsonl.ts'
import type { JEvent } from '../src/state/types.ts'

// 加载 jsonl fixture:逐行 JSON.parse。fixture 是从真实 ~/.claude/projects 抽取并脱敏后的小样本。
function load(name: string): JEvent[] {
  const raw = readFileSync(new URL('./fixtures/jsonl/' + name + '.jsonl', import.meta.url), 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as JEvent)
}

describe('detectTurn', () => {
  it('assistant 收尾(end_turn)→ idle', () => {
    expect(detectTurn(load('turn-idle'))).toBe('idle')
  })
  it('尾部是真实 user prompt → generating', () => {
    expect(detectTurn(load('turn-generating'))).toBe('generating')
  })
  it('assistant 带 tool_use → awaiting-tool', () => {
    expect(detectTurn(load('turn-awaiting-tool'))).toBe('awaiting-tool')
  })
  it('空事件 → idle', () => {
    expect(detectTurn([])).toBe('idle')
  })
})

describe('detectMode', () => {
  it('last-wins 取最后一条 mode', () => {
    expect(detectMode(load('mode'))).toBe('normal')
  })
  it('无 mode 事件 → null', () => {
    expect(detectMode(load('turn-idle'))).toBeNull()
  })
})

describe('detectPermissionMode', () => {
  it('last-wins 取最后一条 permission-mode', () => {
    expect(detectPermissionMode(load('permission-mode'))).toBe('auto')
  })
})

describe('detectTitle', () => {
  it('取最后一条 ai-title', () => {
    expect(detectTitle(load('title'))).toBe('Redacted session title')
  })
})

describe('detectInterrupted', () => {
  it('最近 user 带 interruptedMessageId → true', () => {
    expect(detectInterrupted(load('interrupted'))).toBe(true)
  })
  it('正常回合 → false', () => {
    expect(detectInterrupted(load('turn-idle'))).toBe(false)
  })
})

describe('detectApiError', () => {
  it('最近 assistant 是 API 错误占位 → 返回错误', () => {
    const err = detectApiError(load('apiError'))
    expect(err).not.toBeNull()
    expect(err?.error).toBe('unknown')
  })
  it('正常 assistant → null', () => {
    expect(detectApiError(load('turn-idle'))).toBeNull()
  })
})

describe('detectPending', () => {
  it('取最近一条带计数的 system 行', () => {
    const p = detectPending(load('pending'))
    expect(p.workflows).toBe(1)
    expect(p.agents).toBe(0)
  })
})

describe('detectLastActivity', () => {
  it('返回末行 timestamp', () => {
    const events = load('pending')
    const last = events[events.length - 1]
    expect(detectLastActivity(events)).toBe(last.timestamp)
    expect(typeof detectLastActivity(events)).toBe('string')
  })
})

// ── 回归:本地斜杠命令回声不算「等回复」(CDP 实案:/model 尾巴把状态钉死「生成中」)──
describe('detectTurn:本地命令回声', () => {
  const cmdEcho = {
    type: 'user',
    message: {
      role: 'user',
      content:
        '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>',
    },
  } as unknown as JEvent
  const cmdOut = {
    type: 'user',
    message: { role: 'user', content: '<local-command-stdout>Set model to Opus</local-command-stdout>' },
  } as unknown as JEvent
  const assistantDone = {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
  } as unknown as JEvent
  const realUser = {
    type: 'user',
    message: { role: 'user', content: '真实提问' },
  } as unknown as JEvent

  it('尾巴是 /model 回声 → 越过它取上一条 assistant → idle', () => {
    expect(detectTurn([assistantDone, cmdEcho, cmdOut])).toBe('idle')
  })
  it('整个尾部只有本地命令(/clear 后即 /model)→ idle', () => {
    expect(detectTurn([cmdEcho, cmdOut])).toBe('idle')
  })
  it('真实 user 提问仍是 generating(不被误跳)', () => {
    expect(detectTurn([assistantDone, realUser])).toBe('generating')
  })
})
