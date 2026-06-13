<script setup lang="ts">
// ToolGroup — 一簇连续工具调用(flattenTurn 已把它们并到一起)。
// 对齐 TUI:把**整段** run 折成一行按类型聚合的摘要,如「读取 1 个文件 · 运行 1 条命令 · 编辑 2 处」
// (= TUI 的 "Read 1 file, ran 1 shell command")—— 关联方式就是把 run 里的 tool_use 按工具名计数、各出一句。
// 默认折叠(TUI 折叠态),展开看每条卡。单个工具的 run 保留原样(逐卡、按类型默认展开,见下)。
import { computed, inject, type Ref } from 'vue'
import ToolRow from './blocks/ToolRow.vue'
import { toolComponent } from '../../transcript/registry'
import { RESULT_KEY } from '../../transcript/useToolStatus'
import type { ResultInfo } from '../../transcript/indexResults'
import type { ToolRef } from '../../transcript/flattenTurn'
const props = defineProps<{ tools: ToolRef[] }>()
const multi = computed(() => props.tools.length > 1)
// 多级折叠:顶层 run 展开 → 子项一律展开(open=true);单工具不传 → 用各卡类型默认。

// 任一工具结果报错 → 整段摘要点标红(对齐 TUI 的 ● 按状态着色)。
const resultById = inject<Ref<Record<string, ResultInfo>>>(RESULT_KEY)
const tone = computed(() => {
  for (const t of props.tools) {
    const r = t.block.id && resultById ? resultById.value[t.block.id] : undefined
    if (r?.isError) return 'err'
    if (!r) return 'run' // 还在跑
  }
  return 'ok'
})

// 按类型聚合成「<动词> N <量词>」,保留首次出现顺序,逗号/点连接(对齐 TUI 的逐类型计数)。
function clause(name: string, n: number): string {
  switch (name) {
    case 'Bash':
      return `运行 ${n} 条命令`
    case 'BashOutput':
      return `读取 ${n} 段输出`
    case 'Read':
      return `读取 ${n} 个文件`
    case 'Edit':
    case 'MultiEdit':
      return `编辑 ${n} 处`
    case 'Write':
      return `写入 ${n} 个文件`
    case 'Grep':
    case 'Glob':
      return `搜索 ${n} 次`
    case 'Task':
      return `派 ${n} 个子任务`
    case 'TodoWrite':
      return `更新待办`
    case 'WebFetch':
    case 'WebSearch':
      return `检索 ${n} 次`
    default:
      return `${name} ×${n}`
  }
}
const summary = computed(() => {
  const order: string[] = []
  const cnt: Record<string, number> = {}
  for (const t of props.tools) {
    const k = t.block.name || 'tool'
    if (!(k in cnt)) {
      cnt[k] = 0
      order.push(k)
    }
    cnt[k]++
  }
  return order.map((k) => clause(k, cnt[k])).join(' · ')
})

// 目标预览(文件名/命令摘要)——帮快速辨认这段在干嘛,展开前也有线索。
function targetOf(t: ToolRef): string {
  const i = (t.block.input ?? {}) as Record<string, unknown>
  const v = String(i.description || i.file_path || i.pattern || i.command || i.path || i.url || '')
  const base = v.includes('/') ? v.split('/').pop()! : v
  return base.length > 20 ? base.slice(0, 20) + '…' : base
}
const brief = computed(() => props.tools.map(targetOf).filter(Boolean).slice(0, 4).join('  '))
</script>

<template>
  <!-- ≥2 个工具 → 整段折成一行按类型聚合的摘要(默认折叠,展开看每条) -->
  <ToolRow v-if="multi" :name="summary" :desc="brief" :tone="tone" foldable :default-open="false">
    <component
      :is="toolComponent(t.block.name)"
      v-for="t in tools"
      :key="t.key"
      :block="t.block"
      :open="true"
    />
  </ToolRow>
  <!-- 单个工具 → 逐卡(按类型默认:Bash 折叠,文件类展开) -->
  <component :is="toolComponent(tools[0].block.name)" v-else :block="tools[0].block" />
</template>
