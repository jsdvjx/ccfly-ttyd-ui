// useSend — 把「确认式发送」(sendMessage)包成一个共享管线:一个 AbortController + {phase,error,busy}。
// ChatComposer 用它,逻辑与 InputBridge.run/abort 等价。raw() 直发控制字符(Esc / Shift-Tab 循环权限等)。
import { ref } from 'vue'
import { sendMessage, SendError, type SendPhase } from '../send/sendMessage'
import type { JEvent } from '../state'

export const PHASE_LABEL: Record<string, string> = {
  clear: '① 清空中…',
  type: '② 写入中…',
  submit: '③ 提交+确认中…',
  done: '✓ 已送达',
}

export interface SendBundleDeps {
  send: (s: string) => void
  readInput: () => string
  getEvents: () => JEvent[]
  /** chat 隐藏终端读不到屏 → false 走盲发(只 jsonl 确认)。默认 true。 */
  verifyScreen?: boolean
}

export function useSend(deps: SendBundleDeps) {
  const phase = ref<SendPhase | 'idle' | 'error'>('idle')
  const error = ref('')
  const busy = ref(false)
  let ctrl: AbortController | null = null

  async function run(text: string, submit: boolean): Promise<boolean> {
    if (busy.value) return false
    if (submit && !text) return false
    busy.value = true
    error.value = ''
    phase.value = 'clear'
    ctrl = new AbortController()
    try {
      await sendMessage(text, {
        send: deps.send,
        readInput: deps.readInput,
        events: deps.getEvents,
        submit,
        verifyScreen: deps.verifyScreen,
        signal: ctrl.signal,
        onPhase: (p) => (phase.value = p),
      })
      phase.value = 'done'
      return true
    } catch (e) {
      phase.value = 'error'
      error.value = e instanceof SendError ? `[${e.step} 阶段] ${e.message}` : String(e)
      return false
    } finally {
      busy.value = false
      ctrl = null
    }
  }

  return {
    phase,
    error,
    busy,
    sendText: (t: string) => run(t, true), // 写入并提交
    fillText: (t: string) => run(t, false), // 只填不提交
    interrupt: () => ctrl?.abort(), // 打断进行中的确认式发送
    raw: (s: string) => deps.send(s), // 直发控制字符(不走确认式)
  }
}
