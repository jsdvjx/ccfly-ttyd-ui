// transcript/indexResults.ts — tool_result 关联:tool_use 与其结果在不同的行(结果在「下一条」用户行),
// 且 toolUseResult 不含工具名。这里按 forId(=tool_use_id)建 result 索引,供各工具卡通过 useToolStatus
// 折进对应卡片(running=还没结果 / ok / err)。移植 Jarvis store.ts 的 indexResults。
import type { Item, PatchHunk } from './types'

export interface ResultInfo {
  content?: string
  isError?: boolean
  patch?: PatchHunk[]
  mediaType?: string // 读图片的结果:图片 base64
  data?: string
}

export function indexResults(items: Item[]): Record<string, ResultInfo> {
  const map: Record<string, ResultInfo> = {}
  for (const it of items) {
    if (it.role !== 'user' || !it.blocks) continue
    for (const b of it.blocks) {
      if (b.type === 'tool_result' && b.forId) {
        map[b.forId] = {
          content: b.content,
          isError: b.isError,
          patch: b.patch,
          mediaType: b.mediaType,
          data: b.data,
        }
      }
    }
  }
  return map
}

// itemKey — 稳定 key(优先 uuid;无 uuid 的 system 侧车用复合键)。绝不用数组下标(增量 prepend/dedup 会错位)。
export function itemKey(it: Item): string {
  if (it.uuid) return it.uuid + '|' + (it.blocks?.[0]?.type ?? it.kind ?? '')
  return `${it.role}|${it.ts ?? ''}|${it.kind ?? ''}|${it.blocks?.[0]?.type ?? ''}|${(it.text ?? '').slice(0, 80)}`
}
