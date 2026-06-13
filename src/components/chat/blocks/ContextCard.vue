<script setup lang="ts">
// ContextCard — /context 输出的富渲染:模型头 + 用量条形图 + 分类明细 + MCP/Skills 页脚。
// 取代把 <local-command-stdout> 原文铺成暗淡纯文本的 SystemNotice(见 transcript/parseContext.ts 解析)。
import { computed } from 'vue'
import type { ContextUsage, CtxCategory } from '../../../transcript/parseContext'

const props = defineProps<{ ctx: ContextUsage }>()

const isFree = (c: CtxCategory): boolean => /free\s*space/i.test(c.label)
// 已用分类(画进条形图的彩色段);Free space 单独作底色,不进彩色段。
const used = computed(() => props.ctx.categories.filter((c) => !isFree(c)))
const free = computed(() => props.ctx.categories.find(isFree))

// 分类配色:已知项固定色(对齐语义),其余按调色板轮转。
const PALETTE = ['#4daafc', '#4ec9b0', '#cca700', '#c586c0', '#2ea043', '#e2649b', '#d18616']
function colorFor(label: string, i: number): string {
  const k = label.toLowerCase()
  if (k.includes('system prompt')) return '#4daafc'
  if (k.includes('system tool')) return '#4ec9b0'
  if (k.includes('skill')) return '#cca700'
  if (k.includes('message')) return '#c586c0'
  if (k.includes('mcp')) return '#2ea043'
  if (k.includes('memory') || k.includes('agent')) return '#e2649b'
  return PALETTE[i % PALETTE.length]
}

// 条形图分段:每个已用分类按 pct 给宽度(占满整窗,Free space 为剩余底色)。
// 极小占比(0.3%)给 1.5px 最小宽,保证可见。
const segments = computed(() =>
  used.value.map((c, i) => ({
    label: c.label,
    color: colorFor(c.label, i),
    width: `max(${c.pct}%, 1.5px)`,
  })),
)
</script>

<template>
  <div class="ctx">
    <div class="head">
      <span class="cap">Context Usage</span>
      <span v-if="ctx.usedLabel" class="total">
        <b>{{ ctx.usedLabel }}</b
        ><span class="sl">/</span>{{ ctx.totalLabel }}
        <span v-if="ctx.usedPct != null" class="pct">· {{ ctx.usedPct }}%</span>
      </span>
    </div>

    <div v-if="ctx.model || ctx.modelId" class="model">
      <span v-if="ctx.model" class="mname">{{ ctx.model }}</span>
      <span v-if="ctx.modelId" class="mid">{{ ctx.modelId }}</span>
    </div>

    <div v-if="ctx.categories.length" class="bar">
      <span
        v-for="(s, i) in segments"
        :key="i"
        class="seg"
        :style="{ width: s.width, background: s.color }"
        :title="s.label"
      />
    </div>

    <ul v-if="ctx.categories.length" class="legend">
      <li v-for="(c, i) in used" :key="'u' + i">
        <span class="sw" :style="{ background: colorFor(c.label, i) }" />
        <span class="lb">{{ c.label }}</span>
        <span class="tk">{{ c.tokensLabel }}</span>
        <span class="lp">{{ c.pct }}%</span>
      </li>
      <li v-if="free" class="freerow">
        <span class="sw hollow" />
        <span class="lb">{{ free.label }}</span>
        <span class="tk">{{ free.tokensLabel }}</span>
        <span class="lp">{{ free.pct }}%</span>
      </li>
    </ul>

    <div v-if="ctx.extras.length" class="extras">
      <div v-for="(e, i) in ctx.extras" :key="'e' + i" class="extra">
        <span class="et">{{ e.title }}</span>
        <span v-if="e.sub" class="es">{{ e.sub }}</span>
        <span v-if="e.detail" class="ed">{{ e.detail }}</span>
      </div>
    </div>

    <div v-if="ctx.hint" class="hint">{{ ctx.hint }}</div>
  </div>
</template>

<style scoped>
.ctx {
  max-width: 460px; /* 宽屏别铺满整行:图例/数字拉太开不可读;窄屏自适应 */
  background: var(--card);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 12px 14px;
  margin: 8px 0;
  font-size: 12px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.cap {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--mut);
}
.total {
  font-family: var(--vsc-mono);
  color: var(--mut);
  font-size: 12px;
  white-space: nowrap;
}
.total b {
  color: var(--fg);
  font-weight: 600;
}
.total .sl {
  color: #5a5a5a;
  margin: 0 1px;
}
.total .pct {
  color: var(--acc-fg, #4daafc);
}
.model {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 6px 0 10px;
  flex-wrap: wrap;
}
.mname {
  color: var(--fg);
  font-weight: 600;
  font-size: 13px;
}
.mid {
  font-family: var(--vsc-mono);
  font-size: 11px;
  color: #6e7681;
}
.bar {
  display: flex;
  height: 8px;
  border-radius: 5px;
  overflow: hidden;
  background: #2a2a2a; /* Free space 底色 */
  margin-bottom: 10px;
}
.seg {
  height: 100%;
  flex: none;
}
.seg + .seg {
  box-shadow: -1px 0 0 rgba(0, 0, 0, 0.35); /* 段间细分隔,极窄段也能辨色 */
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sw {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex: none;
}
.sw.hollow {
  background: transparent;
  border: 1.5px solid #4a4a4a;
}
.lb {
  flex: 1;
  min-width: 0;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.freerow .lb {
  color: var(--mut);
}
.tk {
  font-family: var(--vsc-mono);
  color: var(--mut);
  font-size: 11.5px;
  min-width: 52px;
  text-align: right;
}
.lp {
  font-family: var(--vsc-mono);
  color: #6e7681;
  font-size: 11px;
  min-width: 46px;
  text-align: right;
}
.extras {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--bd);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.extra {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-size: 11.5px;
}
.et {
  color: var(--fg);
  font-weight: 600;
}
.es {
  font-family: var(--vsc-mono);
  color: #6e7681;
  font-size: 11px;
}
.ed {
  margin-left: auto;
  font-family: var(--vsc-mono);
  color: var(--mut);
  font-size: 11px;
}
.hint {
  margin-top: 8px;
  font-family: var(--vsc-mono);
  font-size: 11px;
  color: #6e7681;
}
</style>
