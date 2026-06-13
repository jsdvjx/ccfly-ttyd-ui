// transcript/useTranscript.ts — 从 useJsonl 的 events[] 增量派生 { items, resultById, turns }。
// 增量是刚需:useJsonl 用 shallowRef+triggerRef 以 ~20Hz 追加、上限 12000;每次推送都全量重解析会卡。
// 故:缓存 lastLen,只对新增尾部跑 toItem;检测到「长度变小 或 首行 uuid 变了」(useJsonl 在 fresh/switched
// 时会清空 events)→ 全量重建。indexResults/groupTurns 是对已建 items 的廉价整遍,留全量(O(items))。
import { shallowRef, watch, triggerRef, type Ref } from 'vue'
import type { JEvent } from '../state/types'
import type { Item, Turn } from './types'
import { toItem } from './toItems'
import { indexResults, type ResultInfo } from './indexResults'
import { groupTurns } from './turns'

export function useTranscript(events: Ref<JEvent[]>) {
  const items = shallowRef<Item[]>([])
  const resultById = shallowRef<Record<string, ResultInfo>>({})
  const turns = shallowRef<Turn[]>([])
  let lastLen = 0
  let lastFirstUuid: string | undefined

  function recompute(its: Item[]) {
    items.value = its
    resultById.value = indexResults(its)
    turns.value = groupTurns(its)
    triggerRef(items)
    triggerRef(resultById)
    triggerRef(turns)
  }

  function rebuildAll() {
    const its: Item[] = []
    for (const ev of events.value) {
      const it = toItem(ev)
      if (it) its.push(it)
    }
    recompute(its)
    lastLen = events.value.length
    lastFirstUuid = events.value[0]?.uuid
  }

  function update() {
    const evs = events.value
    if (evs.length < lastLen || evs[0]?.uuid !== lastFirstUuid) {
      rebuildAll() // 复位(清空/换文件/压缩)→ 全量
      return
    }
    if (evs.length === lastLen) return
    const its = items.value.slice()
    for (let i = lastLen; i < evs.length; i++) {
      const it = toItem(evs[i]) // 只解析新增尾部
      if (it) its.push(it)
    }
    lastLen = evs.length
    recompute(its)
  }

  watch(events, update, { immediate: true })
  return { items, resultById, turns }
}
