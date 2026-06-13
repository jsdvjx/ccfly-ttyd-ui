// flattenTurn — 把一个 Turn 摊平成「渲染节点」序列,并把**连续的工具调用**合并成一个 tools 组。
// 关键:assistant 的 tool_use 与其 user 端 tool_result(被折进工具卡、不单独渲染)交替出现时,
// 这些「只含 tool_result 的 user 行」不打断工具组,于是「连着跑的几个 Bash」会并到同一组里展示
// (对齐 TUI:一串工具是同一条 rail 上的一簇,而非各自漂浮的卡)。text / 非空 thinking / 图片 / 真用户
// 提问 会打断工具组。空 thinking(未持久化的占位)直接跳过,既不渲染也不打断分组。
import type { Turn, Item, Block } from './types'
import { isRealUserPrompt } from './turns'
import { itemKey } from './indexResults'

export type ToolRef = { block: Block; key: string }
export type TurnNode =
  | { t: 'user'; item: Item; key: string }
  | { t: 'notice'; item: Item; key: string }
  | { t: 'text'; text?: string; key: string }
  | { t: 'thinking'; text?: string; key: string }
  | { t: 'image'; block: Block; uuid?: string; key: string }
  | { t: 'tools'; tools: ToolRef[]; key: string }

export function flattenTurn(turn: Turn): TurnNode[] {
  const out: TurnNode[] = []
  let run: ToolRef[] = []
  const flush = (): void => {
    if (run.length) {
      out.push({ t: 'tools', tools: run, key: 'tg:' + run[0].key })
      run = []
    }
  }
  for (const it of turn.items) {
    const ik = itemKey(it)
    if (it.role === 'user') {
      if (isRealUserPrompt(it)) {
        flush()
        out.push({ t: 'user', item: it, key: ik })
      } else {
        const bs = it.blocks ?? []
        const allToolResult = bs.length > 0 && bs.every((b) => b.type === 'tool_result')
        if (!allToolResult) {
          flush()
          out.push({ t: 'notice', item: it, key: ik })
        }
        // 纯 tool_result 行:已折进工具卡,跳过且**不** flush(让工具组跨它延续)。
      }
      continue
    }
    if (it.role === 'assistant') {
      ;(it.blocks ?? []).forEach((b, i) => {
        const bk = ik + ':' + i
        if (b.type === 'tool_use') {
          run.push({ block: b, key: bk })
        } else if (b.type === 'text') {
          flush()
          out.push({ t: 'text', text: b.text, key: bk })
        } else if (b.type === 'thinking') {
          if ((b.text || '').trim()) {
            flush()
            out.push({ t: 'thinking', text: b.text, key: bk })
          }
          // 空 thinking:跳过,不打断工具组。
        } else if (b.type === 'image') {
          flush()
          out.push({ t: 'image', block: b, uuid: it.uuid, key: bk })
        }
      })
      continue
    }
    // system
    flush()
    out.push({ t: 'notice', item: it, key: ik })
  }
  flush()
  return out
}
