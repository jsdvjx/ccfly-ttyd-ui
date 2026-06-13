// sendSlashCommand —— 基于 sendMessage 的「确认式斜杠命令」。
//
// 公共流程与 sendMessage 一致(清空 → 写入命令 → 读屏验证 → 提交),不同之处是:斜杠命令
// 大多有**明确返回**,但返回来源不一(打印型走 jsonl 的 local-command-stdout;浮层型走读屏解析)。
// 所以「如何确认完成 + 取出结果」抽成一个 spec 回调(resolve),由各命令自定;函数返回 Promise<T>。
//
//   /context : sendMessage + 读 jsonl(fromJsonlStdout)
//   /cost    : sendMessage + 等浮层 + 读屏解析(fromScreenOverlay,读完 Esc 关闭)

import type { JEvent } from '../state'
import { sendMessage, SendError, type SendDeps } from './sendMessage'

const POLL = 50
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SlashCtx {
  screen: string[]
  events: JEvent[]
  sinceEvents: number // 提交时刻的 events 长度:只看其后的新事件
}

export interface SlashSpec<T> {
  /** 轮询:返回结果即完成;返回 undefined 继续等。 */
  resolve: (ctx: SlashCtx) => T | undefined
  /** 完成后发 Esc 关闭浮层(/cost 这类模态需要)。 */
  dismiss?: boolean
  timeout?: number
}

export interface SlashDeps extends SendDeps {
  screen: () => string[]
}

export async function sendSlashCommand<T>(
  command: string,
  spec: SlashSpec<T>,
  deps: SlashDeps,
): Promise<T> {
  const sleep = deps.sleep ?? realSleep

  // 1) 复用 sendMessage:清空 + 写入命令 + 读屏验证(不提交)。
  await sendMessage(command, { ...deps, submit: false })

  // 2) 提交。
  deps.onPhase?.('submit')
  const sinceEvents = deps.events().length
  deps.send('\r')

  // 3) 轮询 spec 取结果。
  const timeout = spec.timeout ?? 10000
  let waited = 0
  for (;;) {
    if (deps.signal?.aborted) throw new SendError('submit', `已打断(等待 ${command} 结果)`)
    const v = spec.resolve({ screen: deps.screen(), events: deps.events(), sinceEvents })
    if (v !== undefined) {
      if (spec.dismiss) deps.send('\x1b') // Esc 关闭浮层
      deps.onPhase?.('done')
      return v
    }
    if (waited >= timeout) {
      throw new SendError('submit', `${command} 未返回结果(${Math.round(timeout / 1000)}s 超时)`)
    }
    await sleep(POLL)
    waited += POLL
  }
}

const reANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

// 工厂 A:从 jsonl 的 <local-command-stdout> 取结果(/context 这类打印型命令)。
export function fromJsonlStdout<T = string>(parse?: (raw: string) => T): SlashSpec<T> {
  return {
    resolve: ({ events, sinceEvents }) => {
      for (let i = Math.max(0, sinceEvents); i < events.length; i++) {
        const c = events[i].content
        if (
          events[i].type === 'system' &&
          typeof c === 'string' &&
          c.includes('<local-command-stdout>')
        ) {
          const raw = c
            .replace(/^[\s\S]*?<local-command-stdout>/, '')
            .replace(/<\/local-command-stdout>[\s\S]*$/, '')
            .replace(reANSI, '')
            .trim()
          return parse ? parse(raw) : (raw as unknown as T)
        }
      }
      return undefined
    },
  }
}

// 工厂 B:命令打开浮层,等它出现**且内容加载稳定**后从屏幕解析(/usage 这类模态)。读完默认 Esc 关闭。
// settlePolls:解析结果连续 N 次轮询(每次 ~50ms)不变才算就绪 —— 面板里有异步加载的元素
// (cost 数字、图表等),不等它稳定就解析会读到骨架、还会过早 Esc 把面板关掉。
export function fromScreenOverlay<T>(
  isReady: (screen: string[]) => boolean,
  parse: (screen: string[]) => T,
  dismiss = true,
  settlePolls = 6,
): SlashSpec<T> {
  let lastSig: string | undefined
  let stable = 0
  return {
    resolve: ({ screen }) => {
      if (!isReady(screen)) {
        lastSig = undefined
        stable = 0
        return undefined
      }
      const v = parse(screen)
      const sig = JSON.stringify(v)
      if (sig === lastSig) {
        stable++
      } else {
        lastSig = sig
        stable = 0
        return undefined
      }
      return stable >= settlePolls ? v : undefined
    },
    dismiss,
  }
}
