// transcript/useToolStatus.ts — 工具卡用:由 tool_use 块查它的结果状态。
// Transcript 用 provide('resultById', ...) 注入结果索引;卡片 useToolStatus(block) 得到
// running(还没结果)| ok | err + 结果文本/patch。复刻 Jarvis 的 useToolStatus。
import { inject, computed, type Ref, type ComputedRef } from 'vue'
import type { Block } from './types'
import type { ResultInfo } from './indexResults'

export const RESULT_KEY = 'ccfly:resultById'

export type ToolStatus = 'running' | 'ok' | 'err'

export function useToolStatus(block: Block): {
  status: ComputedRef<ToolStatus>
  result: ComputedRef<ResultInfo | undefined>
} {
  const map = inject<Ref<Record<string, ResultInfo>>>(RESULT_KEY)
  const result = computed(() => (block.id && map ? map.value[block.id] : undefined))
  const status = computed<ToolStatus>(() => {
    const r = result.value
    if (!r) return 'running'
    return r.isError ? 'err' : 'ok'
  })
  return { status, result }
}
