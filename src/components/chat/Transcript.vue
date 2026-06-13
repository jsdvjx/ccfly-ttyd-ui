<script setup lang="ts">
// Transcript — 滚动容器,负责三件与「按需加载」相关的事(它是唯一持有 scroll el 的组件):
//   ① 近顶 → 触发 loadOlder,并在 prepend 后同步保住视口(锚定 scrollHeight 增量,不跳动);
//   ② 挂载后恢复上次阅读点(localStorage 'ccfly:read:<sid>');无记录 / 记录在「底部」/ 锚点不在当前窗 → 默认贴最新(底部);
//   ③ 滚动防抖保存阅读点(顶端可见 turn 的 anchorUuid + 是否贴底),卸载/换会话前各保存一次。
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import type { Turn } from '../../transcript/types'
import TurnGroup from './TurnGroup.vue'
const props = defineProps<{
  turns: Turn[]
  sid: string
  hasMoreOlder: boolean
  loadingOlder: boolean
  loadOlder: () => Promise<void>
}>()

// /clear 来源:useTerminalSession 在跟随 /clear 切换时写 'ccfly:prev:<sid>',这里读出来在首条消息前
// 显示「由 X 跳转而来」。仅在已翻到最顶(没有更老的可载)时显示,免得插在历史中间误导。
const prevSession = computed<{ sid: string; title?: string } | null>(() => {
  if (!props.sid) return null
  try {
    const s = localStorage.getItem('ccfly:prev:' + props.sid)
    return s ? (JSON.parse(s) as { sid: string; title?: string }) : null
  } catch {
    return null
  }
})

const el = ref<HTMLElement | null>(null)
let pinned = true // 贴底:tail 追加时跟随到底
let restored = false // 本会话是否已恢复过阅读点(每个 sid 一次)
let saveTimer = 0

function nearBottom(e: HTMLElement): boolean {
  return e.scrollHeight - e.scrollTop - e.clientHeight < 80
}

// 顶端首个「可见」turn 的 anchorUuid(保存阅读点用)。
function topAnchor(e: HTMLElement): string {
  const groups = e.querySelectorAll<HTMLElement>('[data-anchor]')
  for (const g of groups) {
    if (g.offsetTop + g.offsetHeight > e.scrollTop + 4) return g.dataset.anchor || ''
  }
  return ''
}

function savePos(): void {
  const e = el.value
  if (!e || !props.sid) return
  const atBottom = nearBottom(e)
  const anchorUuid = atBottom ? '' : topAnchor(e)
  try {
    localStorage.setItem('ccfly:read:' + props.sid, JSON.stringify({ anchorUuid, atBottom }))
  } catch {
    /* 配额/隐私模式:忽略 */
  }
}
function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = window.setTimeout(() => {
    saveTimer = 0
    savePos()
  }, 400)
}

// 恢复阅读点:有锚点且非贴底且锚点在当前窗内 → 滚到它;否则贴最新(底部)。
function restorePos(): void {
  const e = el.value
  if (!e) return
  let rec: { anchorUuid?: string; atBottom?: boolean } | null = null
  try {
    const s = localStorage.getItem('ccfly:read:' + props.sid)
    if (s) rec = JSON.parse(s)
  } catch {
    /* ignore */
  }
  if (rec && !rec.atBottom && rec.anchorUuid) {
    const target = e.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(rec.anchorUuid)}"]`)
    if (target) {
      e.scrollTop = Math.max(0, target.offsetTop - 8)
      pinned = false
      return
    }
  }
  e.scrollTop = e.scrollHeight // 默认最新
  pinned = true
}

function onScroll(): void {
  const e = el.value
  if (!e) return
  pinned = nearBottom(e)
  scheduleSave()
  // 近顶且还有更老 → 翻页(prepend 时保住视口)。
  if (e.scrollTop < 240 && props.hasMoreOlder && !props.loadingOlder) void doLoadOlder()
}

// 翻页 + 视口锚定:同步记下 prepend 前的 scrollHeight/scrollTop,prepend 渲染完后把 scrollTop 加上高度增量,
// 视觉上保持不动。Transcript 自己驱动时机,故不与 tail 追加的 turns watcher 抢(近顶时 pinned=false,不会被拽到底)。
async function doLoadOlder(): Promise<void> {
  const e = el.value
  if (!e) return
  const prevH = e.scrollHeight
  const prevT = e.scrollTop
  await props.loadOlder()
  await nextTick()
  const e2 = el.value
  if (e2) e2.scrollTop = prevT + (e2.scrollHeight - prevH)
}

// turns 每次重算是新数组 → 触发。首个非空 → 恢复阅读点(每会话一次);此后贴底则跟随到底(prepend 时 pinned=false 不跟随)。
watch(
  () => props.turns,
  async () => {
    await nextTick()
    const e = el.value
    if (!e) return
    if (!restored && props.turns.length) {
      restorePos()
      restored = true
      return
    }
    if (pinned) e.scrollTop = e.scrollHeight
  },
)

// 换会话:重置「已恢复」标记,让新会话重新恢复其阅读点(Transcript 不随 sid 重挂载)。
watch(
  () => props.sid,
  () => {
    restored = false
    pinned = true
  },
)

onUnmounted(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  savePos() // 卸载(切 term/关标签)前落一次
})
</script>

<template>
  <div ref="el" class="scroll" @scroll="onScroll">
    <div v-if="loadingOlder" class="older">载入更早…</div>
    <div v-if="prevSession && !hasMoreOlder && turns.length" class="prev">
      ⤷ /clear 自「{{ prevSession.title || prevSession.sid.slice(0, 8) }}」跳转而来
    </div>
    <TurnGroup v-for="(t, i) in turns" :key="t.anchorUuid || 't' + i" :turn="t" :sid="sid" />
    <div v-if="!turns.length" class="empty">(空会话 / 加载中…)</div>
  </div>
</template>

<style scoped>
.scroll {
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain; /* 滚到头不外传:免得把外层/文档拽出空地 */
  padding: 12px 16px 24px;
  min-height: 0;
  position: relative; /* 子 turn 的 offsetTop 以此为基准(恢复阅读点定位用) */
}
.prev {
  text-align: center;
  color: var(--mut);
  font-size: 11px;
  padding: 2px 0 10px;
}
.older {
  text-align: center;
  color: var(--mut);
  font-size: 11px;
  padding: 4px 0 8px;
}
.empty {
  color: var(--mut);
  font-size: 12px;
  text-align: center;
  padding: 48px;
}
</style>
