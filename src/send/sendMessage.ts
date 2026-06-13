// sendMessage —— 「确认式发送」:对 sendkey 抽象一层,每一步都验证,失败报明确错误。
//
// 流程(任意节点超时/打断 → 抛带阶段的 SendError):
//   1) clear  : 分帧逐发清空键 → 读屏确认输入框已空
//   2) type   : bracketed paste 写入 → 读屏确认输入框 == 文本(多行折叠成 chip 时结构性确认)
//   3) submit : 回车 → 读 jsonl 确认出现匹配的 user 消息(jsonl 是权威:真的发出去了)
//
// 依赖以函数注入(send / readInput / events),便于在测试里 mock 整个流程。

import type { JEvent } from '../state'

export type SendStep = 'clear' | 'type' | 'submit'
export type SendPhase = SendStep | 'done'

export class SendError extends Error {
  step: SendStep
  observed?: string
  constructor(step: SendStep, message: string, observed?: string) {
    super(message)
    this.name = 'SendError'
    this.step = step
    this.observed = observed
  }
}

export interface SendDeps {
  /** 把字节写进 PTY(INPUT 轨)。 */
  send: (s: string) => void
  /** 当前输入框里的用户内容(已去 ❯ 前缀、多行 join)。见 extractInputBox。 */
  readInput: () => string
  /** 当前已收到的 jsonl 事件(随 SSE 增长)。 */
  events: () => JEvent[]
  /** false 则只到 type 为止(填入但不发送)。默认 true。 */
  submit?: boolean
  /** 是否用读屏确认 clear/type(默认 true)。chat 隐藏终端读不到屏 → 传 false 走「盲发」:
   *  只发字节 + 短等待,靠 submit 的 jsonl 确认是否真发出。 */
  verifyScreen?: boolean
  /** 打断信号。 */
  signal?: AbortSignal
  /** 阶段回调(给 UI 显示进度)。 */
  onPhase?: (p: SendPhase) => void
  timeouts?: { clear?: number; type?: number; submit?: number }
  /** 可注入(测试用);默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUTS = { clear: 2000, type: 3000, submit: 10000 }
const POLL = 50
const CLEAR_FRAMES = 24

const wrapPaste = (t: string): string => '\x1b[200~' + t + '\x1b[201~'
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// extractInputBox —— 从屏幕行取输入框用户内容:底部两条 ─── 边框之间,去掉 ❯ 前缀,多行 join。
export function extractInputBox(lines: string[]): string {
  const borders: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*─{6,}\s*$/.test(lines[i])) borders.push(i)
  }
  if (borders.length < 2) return ''
  const lo = borders[borders.length - 2]
  const hi = borders[borders.length - 1]
  const inner = lines.slice(lo + 1, hi)
  const cleaned = inner.map((l, idx) =>
    idx === 0 ? l.replace(/^\s*[❯›>]\s?/, '') : l.replace(/^\s{0,2}/, ''),
  )
  return cleaned.join('\n').replace(/\s+$/, '')
}

const PASTE_CHIP = /\[Pasted text/i

// inputMatches —— 输入框是否「就是」期望文本:单行精确;多行被折叠成 paste chip 时结构性确认。
export function inputMatches(box: string, text: string): boolean {
  const b = box.trim()
  if (b === text.trim()) return true
  if (PASTE_CHIP.test(b)) return true
  return false
}

function userText(e: JEvent): string {
  const c = e.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((b) =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text'
          ? ((b as { text?: string }).text ?? '')
          : '',
      )
      .join('')
  }
  return ''
}

// findUserEvent —— sinceIndex 之后是否出现内容匹配的真实 user 消息(jsonl 权威)。
export function findUserEvent(events: JEvent[], text: string, sinceIndex: number): JEvent | null {
  const want = text.trim()
  for (let i = Math.max(0, sinceIndex); i < events.length; i++) {
    const e = events[i]
    if (e.type !== 'user' || e.isMeta) continue
    const ut = userText(e).trim()
    // 单行严格相等;仅多行(可能被折叠/换行)才允许 includes 兜底,避免「ok」误命中「ok done」。
    if (ut === want || (want.includes('\n') && want.length > 0 && ut.includes(want))) return e
  }
  return null
}

export async function sendMessage(text: string, deps: SendDeps): Promise<void> {
  const sleep = deps.sleep ?? realSleep
  const t = { ...DEFAULT_TIMEOUTS, ...deps.timeouts }
  const submit = deps.submit !== false
  const verifyScreen = deps.verifyScreen !== false

  const ckAbort = (step: SendStep): void => {
    if (deps.signal?.aborted) throw new SendError(step, `已打断(${step} 阶段)`)
  }

  const waitUntil = async (
    step: SendStep,
    pred: () => boolean,
    timeout: number,
    errMsg: () => string,
  ): Promise<void> => {
    let waited = 0
    for (;;) {
      ckAbort(step)
      if (pred()) return
      if (waited >= timeout) throw new SendError(step, errMsg(), undefined)
      await sleep(POLL)
      waited += POLL
    }
  }

  // 1) clear:分帧逐发(每帧 3 字节 + 小间隔),否则会被 claude 当批量字面,清不掉。
  deps.onPhase?.('clear')
  for (let i = 0; i < CLEAR_FRAMES; i++) {
    ckAbort('clear')
    deps.send('\x01\x0b\x7f')
    await sleep(10)
  }
  if (verifyScreen) {
    await waitUntil(
      'clear',
      () => deps.readInput().trim() === '',
      t.clear,
      () => `清空失败:输入框仍为「${deps.readInput()}」`,
    )
  } else {
    await sleep(120) // 盲发:给清空键落地,不读屏确认
  }

  // 2) type:bracketed paste 整段写入。
  deps.onPhase?.('type')
  deps.send(wrapPaste(text))
  if (verifyScreen) {
    await waitUntil(
      'type',
      () => inputMatches(deps.readInput(), text),
      t.type,
      () => `写入失败:输入框为「${deps.readInput()}」,期望「${text}」`,
    )
  } else {
    await sleep(200) // 盲发:给 paste 落地,靠 submit 的 jsonl 确认是否真发出
  }

  if (!submit) {
    deps.onPhase?.('done')
    return
  }

  // 3) submit:回车 + jsonl 确认(真的发出去了)。
  deps.onPhase?.('submit')
  const sinceIndex = deps.events().length
  deps.send('\r')
  if (verifyScreen) {
    await waitUntil(
      'submit',
      () => findUserEvent(deps.events(), text, sinceIndex) !== null,
      t.submit,
      () => `提交未确认:jsonl 未出现匹配的 user 消息(${Math.round(t.submit / 1000)}s 超时)`,
    )
  } else {
    // 盲发:回车已发出 → 视为已提交(claude 空闲即处理、繁忙则排队稍后发)。jsonl 确认为 best-effort:
    // 拿到就提前结束(✓),超时也照常 done、不报红错。打断仍立即抛出。
    let waited = 0
    while (waited < t.submit) {
      ckAbort('submit')
      if (findUserEvent(deps.events(), text, sinceIndex) !== null) break
      await sleep(POLL)
      waited += POLL
    }
  }

  deps.onPhase?.('done')
}
