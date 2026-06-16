<script setup lang="ts">
// TurnGroup — 一个回合:摊平成节点(连续工具已合并成组)逐节点渲染,并画一条贯穿的时间线竖线。
// rail 用 JS 量「首点中心→末点中心」,严格止于末点;工具展开/折叠改高度 → ResizeObserver 重量;turns 变 → 重量。
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { Turn } from '../../transcript/types'
import { flattenTurn } from '../../transcript/flattenTurn'
import { fmtDur, fmtTok } from '../../fmt'
import MsgBoundary from './MsgBoundary.vue'
import ToolGroup from './ToolGroup.vue'
import UserBubble from './blocks/UserBubble.vue'
import Notice from './blocks/Notice.vue'
import AssistantText from './blocks/AssistantText.vue'
import ThinkingBlock from './blocks/ThinkingBlock.vue'
import ImageChip from './blocks/ImageChip.vue'
import BashLocalCard from './blocks/BashLocalCard.vue'
import Row from './blocks/Row.vue'
const props = defineProps<{ turn: Turn; sid: string }>()
const nodes = computed(() => flattenTurn(props.turn))
const foot = computed(() => {
  const parts: string[] = []
  if (props.turn.durSec) parts.push(fmtDur(props.turn.durSec))
  if (props.turn.outTokens) parts.push(fmtTok(props.turn.outTokens) + ' tok')
  return parts.join(' · ')
})

const turnEl = ref<HTMLElement | null>(null)
const rail = ref({ top: 0, height: 0, show: false })
let ro: ResizeObserver | null = null
let raf = 0
function measure(): void {
  const el = turnEl.value
  if (!el) return
  const dots = el.querySelectorAll<HTMLElement>('.dot')
  if (dots.length < 2) {
    rail.value = { top: 0, height: 0, show: false }
    return
  }
  const first = dots[0]
  const last = dots[dots.length - 1]
  const top = first.offsetTop + first.offsetHeight / 2
  const bottom = last.offsetTop + last.offsetHeight / 2
  rail.value = { top, height: Math.max(0, bottom - top), show: true }
}
function schedule(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    measure()
  })
}
onMounted(() => {
  measure()
  if (turnEl.value) {
    ro = new ResizeObserver(schedule)
    ro.observe(turnEl.value)
  }
})
onUnmounted(() => {
  ro?.disconnect()
  if (raf) cancelAnimationFrame(raf)
})
watch(
  () => props.turn,
  () => nextTick(measure),
)
</script>

<template>
  <div ref="turnEl" class="turn" :data-anchor="turn.anchorUuid">
    <div
      v-show="rail.show"
      class="rail"
      :style="{ top: rail.top + 'px', height: rail.height + 'px' }"
    />
    <MsgBoundary v-for="n in nodes" :key="n.key">
      <UserBubble v-if="n.t === 'user'" :item="n.item" :sid="sid" />
      <Notice v-else-if="n.t === 'notice'" :item="n.item" />
      <AssistantText v-else-if="n.t === 'text'" :text="n.text" />
      <ThinkingBlock v-else-if="n.t === 'thinking'" :text="n.text" />
      <Row v-else-if="n.t === 'image'" tone="fg">
        <ImageChip :block="n.block" :sid="sid" :uuid="n.uuid" />
      </Row>
      <Row v-else-if="n.t === 'bash'" tone="fg">
        <BashLocalCard :blocks="n.blocks" />
      </Row>
      <ToolGroup v-else-if="n.t === 'tools'" :tools="n.tools" />
    </MsgBoundary>
    <div v-if="foot" class="foot">✻ {{ foot }}</div>
  </div>
</template>

<style scoped>
.turn {
  margin-bottom: 8px;
  position: relative; /* rail / 点的 offsetTop 基准 */
}
.rail {
  position: absolute;
  left: 3px; /* 对齐点中心(点宽 7 → 中心 3.5) */
  width: 1px;
  background: #383838;
  z-index: 0;
}
.foot {
  color: #6e7681;
  font-size: 11px;
  margin: 4px 0 14px 19px; /* 19px = 点(7) + 间距(12),与内容列对齐 */
}
</style>
