import { describe, it, expect } from 'vitest'
import {
  sendSlashCommand,
  fromJsonlStdout,
  fromScreenOverlay,
} from '../src/send/sendSlashCommand.ts'
import { SendError } from '../src/send/sendMessage.ts'
import type { JEvent } from '../src/state/types.ts'

const noSleep = (): Promise<void> => Promise.resolve()

// mock:解释字节维护 input/events/screen;\r 时调 onSubmit 模拟命令产生结果。
function harness(onSubmit: (h: { events: JEvent[]; setScreen: (s: string[]) => void }) => void) {
  let input = 'old junk'
  const events: JEvent[] = []
  let screen: string[] = []
  const sent: string[] = []
  const send = (s: string) => {
    sent.push(s)
    if (s.includes('\x01')) input = ''
    else if (s.startsWith('\x1b[200~'))
      input = s.replace(/^\x1b\[200~/, '').replace(/\x1b\[201~$/, '')
    else if (s === '\r') onSubmit({ events, setScreen: (x) => (screen = x) })
  }
  const deps = {
    send,
    readInput: () => input,
    events: () => events,
    screen: () => screen,
    sleep: noSleep,
    timeouts: { clear: 300, type: 300, submit: 300 },
  }
  return { deps, sent }
}

describe('sendSlashCommand', () => {
  it('/context:从 jsonl 的 local-command-stdout 取结果', async () => {
    const { deps } = harness(({ events }) => {
      events.push({
        type: 'system',
        subtype: 'local_command',
        content: '<local-command-stdout>Context Usage: 18.5k/1m tokens</local-command-stdout>',
      })
    })
    const out = await sendSlashCommand('/context', fromJsonlStdout<string>(), deps)
    expect(out).toBe('Context Usage: 18.5k/1m tokens')
  })

  it('/context:带 parse 解析', async () => {
    const { deps } = harness(({ events }) => {
      events.push({
        type: 'system',
        content: '<local-command-stdout>42 tokens</local-command-stdout>',
      })
    })
    const n = await sendSlashCommand(
      '/context',
      fromJsonlStdout((raw) => parseInt(raw, 10)),
      deps,
    )
    expect(n).toBe(42)
  })

  it('/cost:等浮层出现→读屏解析→Esc 关闭', async () => {
    const { deps, sent } = harness(({ setScreen }) => {
      setScreen(['Manage', '95% of your usage came from subagent-heavy sessions', 'Sessions: 58'])
    })
    const isReady = (s: string[]) => s.some((l) => /% of your usage/.test(l))
    const parse = (s: string[]) => s.filter((l) => /usage|Sessions/i.test(l))
    const res = await sendSlashCommand('/cost', fromScreenOverlay(isReady, parse, true), deps)
    expect(res).toContain('Sessions: 58')
    expect(sent).toContain('\x1b') // dismiss 发了 Esc
  })

  it('无结果 -> SendError(submit) 超时', async () => {
    const { deps } = harness(() => {
      /* 提交后什么都不产生 */
    })
    await expect(
      sendSlashCommand('/context', fromJsonlStdout<string>(), deps),
    ).rejects.toBeInstanceOf(SendError)
  })

  it('打断 -> SendError', async () => {
    const { deps } = harness(() => {})
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      sendSlashCommand('/context', fromJsonlStdout<string>(), { ...deps, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(SendError)
  })
})
