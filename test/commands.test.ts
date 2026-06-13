import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runContext, runUsage } from '../src/send/commands.ts'
import type { SlashDeps } from '../src/send/sendSlashCommand.ts'
import { SendError } from '../src/send/sendMessage.ts'
import type { JEvent } from '../src/state/types.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')
const noSleep = (): Promise<void> => Promise.resolve()

// mock:维护 input/events/screen;\r 时调 onSubmit 模拟命令产生结果。
function harness(opts: {
  onSubmit?: (h: { events: JEvent[]; setScreen: (s: string[]) => void }) => void
  initialScreen?: string[]
}) {
  let input = 'old junk'
  let screen = opts.initialScreen ?? []
  const events: JEvent[] = []
  const sent: string[] = []
  const send = (s: string) => {
    sent.push(s)
    if (s.includes('\x01')) input = ''
    else if (s.startsWith('\x1b[200~'))
      input = s.replace(/^\x1b\[200~/, '').replace(/\x1b\[201~$/, '')
    else if (s === '\r') opts.onSubmit?.({ events, setScreen: (x) => (screen = x) })
  }
  const deps: SlashDeps = {
    send,
    readInput: () => input,
    events: () => events,
    screen: () => screen,
    sleep: noSleep,
    timeouts: { clear: 300, type: 300, submit: 300 },
  }
  return { deps, sent }
}

const USAGE_MODAL = [
  'Settings  Status   Config   Usage   Stats',
  'Total cost:            $0.0000',
  'Last 24h · these are independent characteristics of your usage',
  'Sessions: 58',
  '  Esc to cancel',
]

describe('runUsage(回归:钉死已验证坑)', () => {
  it('发出的命令文本是 /usage,不是 /cost', async () => {
    const { deps, sent } = harness({ onSubmit: ({ setScreen }) => setScreen(USAGE_MODAL) })
    await runUsage(deps)
    const typed = sent.find((s) => s.startsWith('\x1b[200~')) ?? ''
    expect(typed).toContain('/usage')
    expect(typed).not.toContain('/cost')
  })

  it('历史残留(idle 屏 + 旧用量行)不提前 resolve → 超时报错', async () => {
    // detectUsage 命中残留行,但 detectIdle 也命中(输入框还在)→ isReady=false,不该返回脏数据。
    const stale = [...fx('idle'), '95% of your usage came from subagent-heavy sessions']
    const { deps } = harness({ initialScreen: stale, onSubmit: () => {} }) // 提交后屏不变
    await expect(runUsage(deps)).rejects.toBeInstanceOf(SendError)
  })

  it('真模态(用量内容 + 非 idle)→ 返回解析出的统计行', async () => {
    const { deps } = harness({ onSubmit: ({ setScreen }) => setScreen(USAGE_MODAL) })
    const r = await runUsage(deps)
    expect(r.some((l) => /Sessions: 58|Total cost/.test(l))).toBe(true)
  })
})

describe('runContext(走 jsonl)', () => {
  it('从 local-command-stdout 取原文', async () => {
    const { deps } = harness({
      onSubmit: ({ events }) =>
        events.push({
          type: 'system',
          content: '<local-command-stdout>Context Usage 18.5k/1m tokens</local-command-stdout>',
        }),
    })
    const out = await runContext(deps)
    expect(out).toContain('Context Usage')
  })
})
