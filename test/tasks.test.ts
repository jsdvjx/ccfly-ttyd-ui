import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectTasks } from '../src/state/detectors/tasks.ts'
import { detectTurnMeta } from '../src/state/detectors/jsonl.ts'
import type { JEvent } from '../src/state/types.ts'

function load(name: string): JEvent[] {
  const raw = readFileSync(new URL('./fixtures/jsonl/' + name + '.jsonl', import.meta.url), 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as JEvent)
}

describe('detectTasks(TaskCreate/TaskUpdate 折叠)', () => {
  it('创建 ×2 + 更新 #1 → in_progress,#2 仍 pending,id 从 toolUseResult 回填', () => {
    const tasks = detectTasks(load('tasks'))
    expect(tasks).toEqual([
      {
        id: '1',
        subject: '接线:control.go/sessions.go/sse.go/scanner.go',
        status: 'in_progress',
        activeForm: '接线控制端点',
      },
      {
        id: '2',
        subject: 'main.go:panemap-hook 子命令',
        status: 'pending',
        activeForm: '实现 panemap-hook',
      },
    ])
  })

  it('TaskCreate 结果没给 id(创建失败)→ 移除占位', () => {
    const evs = load('tasks').slice(0, 3)
    // 把成功结果换成失败(无 toolUseResult.task)
    evs[2] = { ...evs[2], toolUseResult: undefined }
    expect(detectTasks(evs)).toEqual([])
  })

  it("TaskUpdate status='deleted' → 删行", () => {
    const evs = [
      ...load('tasks'),
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_update_2',
              name: 'TaskUpdate',
              input: { taskId: '2', status: 'deleted' },
            },
          ],
        },
      } as JEvent,
    ]
    expect(detectTasks(evs).map((t) => t.id)).toEqual(['1'])
  })

  it('sidechain(子代理)的任务不入主列表', () => {
    const evs = load('tasks').map((e) => ({ ...e, isSidechain: true }))
    expect(detectTasks(evs)).toEqual([])
  })

  it('空事件 → 空列表', () => {
    expect(detectTasks([])).toEqual([])
  })
})

describe('detectTasks(TodoWrite 快照)', () => {
  it('todos 全量替换,id 用序号', () => {
    const tasks = detectTasks(load('todos'))
    expect(tasks).toEqual([
      { id: '1', subject: '搭骨架', status: 'completed', activeForm: '搭建骨架' },
      { id: '2', subject: '接数据层', status: 'in_progress', activeForm: '接入数据层' },
      { id: '3', subject: '写测试', status: 'pending', activeForm: '编写测试' },
    ])
  })
})

describe('detectTurnMeta(回合起点 + ↑token)', () => {
  it('起点 = 最后一条真实 prompt;token = 其后 assistant output_tokens 累计', () => {
    const meta = detectTurnMeta(load('tasks'))
    expect(meta.startedAt).toBe('2026-06-08T07:00:00.000Z')
    expect(meta.outputTokens).toBe(100 + 50 + 25)
  })

  it('尾部 tool_result 回填不算新回合(起点不动)', () => {
    // fixture 最后一行就是 tool_result,起点仍是行 1 的 prompt —— 已由上例覆盖;
    // 这里验证只有 tool_result、没有真实 prompt 时 → null。
    const evs = load('tasks').filter((e) => e.type !== 'user' || Array.isArray(e.message?.content))
    expect(detectTurnMeta(evs).startedAt).toBeNull()
  })

  it('空事件 → null/0', () => {
    expect(detectTurnMeta([])).toEqual({ startedAt: null, outputTokens: 0 })
  })
})
