// transcript/turns.ts — 把扁平 items 按「轮次」分组:一轮 = 从一条真·用户提问到下一条之前。
// 真·用户提问 = role=user 且非 isMeta 且不是「纯 tool_result 回传」。每轮带锚点 uuid、耗时、输出 token,
// 供 TurnGroup 分组 + TurnFooter 展示。
import type { Item, Turn } from './types'
import { isLocalCommandText } from './parseContext'

// isRealUserPrompt — 是否一条真正的用户提问(而非工具结果回传 / 注入的伪用户行)。
export function isRealUserPrompt(it: Item): boolean {
  if (it.role !== 'user') return false
  if (it.raw?.isMeta) return false
  // 斜杠命令的回显/输出有时以 user 事件落盘(<command-name>/<local-command-stdout>/caveat)
  // → 伪用户行,交给 Notice 富渲染,不能当提问铺原文。
  if (isLocalCommandText(it.text || '')) return false
  const blocks = it.blocks ?? []
  if (blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')) return false
  return true
}

export function groupTurns(items: Item[]): Turn[] {
  const turns: Turn[] = []
  let cur: Turn | null = null
  for (const it of items) {
    if (isRealUserPrompt(it) || !cur) {
      cur = { items: [], durSec: 0, outTokens: 0 }
      turns.push(cur)
    }
    cur.items.push(it)
    if (it.role === 'assistant') {
      if (it.uuid) cur.anchorUuid = it.uuid
      cur.outTokens += it.outTokens ?? 0
    }
  }
  for (const t of turns) {
    const first = t.items[0]?.ts
    const last = t.items[t.items.length - 1]?.ts
    if (first && last) {
      const d = (Date.parse(last) - Date.parse(first)) / 1000
      if (d > 0) t.durSec = Math.round(d)
    }
  }
  return turns
}
