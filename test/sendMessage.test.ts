import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  sendMessage,
  SendError,
  extractInputBox,
  inputMatches,
  findUserEvent,
  type SendPhase,
} from '../src/send/sendMessage.ts'
import type { JEvent } from '../src/state/types.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

const noSleep = (): Promise<void> => Promise.resolve()

// 模拟 claude 输入框:解释字节,维护 input + events,供 readInput/events 读。
function makeHarness(opts: { breakStep?: 'clear' | 'type' | 'submit' } = {}) {
  let input = 'leftover junk'
  const events: JEvent[] = []
  const send = (s: string) => {
    if (s.includes('\x01')) {
      if (opts.breakStep !== 'clear') input = '' // 清空键
    } else if (s.startsWith('\x1b[200~')) {
      if (opts.breakStep !== 'type') input = s.replace(/^\x1b\[200~/, '').replace(/\x1b\[201~$/, '')
    } else if (s === '\r') {
      if (opts.breakStep !== 'submit')
        events.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: input } })
    }
  }
  return {
    send,
    readInput: () => input,
    events: () => events,
    sleep: noSleep,
    timeouts: { clear: 300, type: 300, submit: 300 },
  }
}

describe('extractInputBox', () => {
  it('单行', () =>
    expect(extractInputBox(['hist', '──────', '❯ hello world', '──────', 'foot'])).toBe(
      'hello world',
    ))
  it('多行', () =>
    expect(extractInputBox(['──────', '❯ a', '  b', '  c', '──────'])).toBe('a\nb\nc'))
  it('空', () => expect(extractInputBox(['──────', '❯ ', '──────'])).toBe(''))
  it('无边框 -> 空', () => expect(extractInputBox(['just text'])).toBe(''))
  it('真实 idle 帧 -> 空', () => expect(extractInputBox(fx('idle'))).toBe(''))
  it('真实 idle_typing 帧 -> 取到草稿', () =>
    expect(extractInputBox(fx('idle_typing'))).toBe('draft message not yet sent'))
})

describe('inputMatches', () => {
  it('单行精确', () => expect(inputMatches('hi there', 'hi there')).toBe(true))
  it('不符', () => expect(inputMatches('hi', 'bye')).toBe(false))
  it('多行折叠成 chip 也算', () =>
    expect(inputMatches('[Pasted text #1 +4 lines]', 'a\nb\nc\nd\ne')).toBe(true))
})

describe('findUserEvent', () => {
  const evs: JEvent[] = [
    { type: 'assistant', uuid: 'a' },
    { type: 'user', isMeta: true, message: { content: 'meta' } },
    { type: 'user', uuid: 'u', message: { content: 'hello world' } },
  ]
  it('找到匹配的真实 user', () => expect(findUserEvent(evs, 'hello world', 0)?.uuid).toBe('u'))
  it('忽略 isMeta', () => expect(findUserEvent(evs, 'meta', 0)).toBeNull())
  it('sinceIndex 之前的不算', () => expect(findUserEvent(evs, 'hello world', 3)).toBeNull())
})

describe('sendMessage', () => {
  it('happy path:清空→写入→提交,阶段齐全', async () => {
    const h = makeHarness()
    const phases: SendPhase[] = []
    await sendMessage('hi there', { ...h, onPhase: (p) => phases.push(p) })
    expect(phases).toEqual(['clear', 'type', 'submit', 'done'])
    expect(h.events()).toHaveLength(1)
    expect(h.events()[0].message?.content).toBe('hi there')
  })

  it('submit=false:只清空+写入,不提交', async () => {
    const h = makeHarness()
    await sendMessage('draft', { ...h, submit: false })
    expect(h.readInput()).toBe('draft')
    expect(h.events()).toHaveLength(0)
  })

  it('清空失败 -> SendError(clear)', async () => {
    const h = makeHarness({ breakStep: 'clear' })
    await expect(sendMessage('x', h)).rejects.toMatchObject({ step: 'clear' })
  })

  it('写入失败 -> SendError(type)', async () => {
    const h = makeHarness({ breakStep: 'type' })
    await expect(sendMessage('x', h)).rejects.toMatchObject({ step: 'type' })
  })

  it('提交未确认 -> SendError(submit)', async () => {
    const h = makeHarness({ breakStep: 'submit' })
    await expect(sendMessage('x', h)).rejects.toMatchObject({ step: 'submit' })
  })

  it('打断 -> SendError 且带阶段', async () => {
    const h = makeHarness()
    const ctrl = new AbortController()
    ctrl.abort()
    const err = await sendMessage('x', { ...h, signal: ctrl.signal }).catch((e) => e)
    expect(err).toBeInstanceOf(SendError)
    expect(err.step).toBe('clear')
  })

  // chat 隐藏终端读不到屏 → readInput 永远空。verifyScreen=false 盲发应仍成功(只靠 jsonl 确认)。
  it('盲发(verifyScreen=false):读屏永远空也能完成,靠 jsonl 确认', async () => {
    const events: JEvent[] = []
    const sent: string[] = []
    const send = (s: string): void => {
      sent.push(s)
      if (s === '\r')
        events.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } })
    }
    await sendMessage('hello', {
      send,
      readInput: () => '', // 隐藏终端:读屏永远空
      events: () => events,
      verifyScreen: false,
      sleep: noSleep,
      timeouts: { clear: 300, type: 300, submit: 300 },
    })
    expect(sent.some((s) => s.includes('hello'))).toBe(true) // paste 了文本
    expect(events).toHaveLength(1) // 回车后 jsonl 出现 user 消息 = 确认成功
  })

  it('对照:verifyScreen=true 读屏空 → type 阶段写入失败', async () => {
    const events: JEvent[] = []
    await expect(
      sendMessage('hello', {
        send: () => {},
        readInput: () => '',
        events: () => events,
        sleep: noSleep,
        timeouts: { clear: 100, type: 100, submit: 100 },
      }),
    ).rejects.toMatchObject({ step: 'type' })
  })

  // claude 繁忙 → 回车后 10s 内 jsonl 不出现 user 消息(排队稍后发)。盲发应「乐观 done」不报红错。
  it('盲发 submit 无 jsonl 确认 → 乐观 done(不抛),回车已发出', async () => {
    const events: JEvent[] = []
    const sent: string[] = []
    await sendMessage('hello', {
      send: (s) => sent.push(s), // 不 push user:模拟 claude 繁忙、10s 内未提交
      readInput: () => '',
      events: () => events,
      verifyScreen: false,
      sleep: noSleep,
      timeouts: { clear: 100, type: 100, submit: 200 },
    })
    expect(sent).toContain('\r') // 回车确实发出(claude 空闲即处理、繁忙则排队)
  })

  it('盲发 submit 仍响应打断', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const err = await sendMessage('hello', {
      send: () => {},
      readInput: () => '',
      events: () => [],
      verifyScreen: false,
      signal: ctrl.signal,
      sleep: noSleep,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(SendError)
  })
})
