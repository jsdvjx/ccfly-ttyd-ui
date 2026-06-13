<script setup lang="ts">
// GenericCard — 未专门建卡的工具回退:时间线行 +(折叠)输入 JSON + 结果。
import { computed } from 'vue'
import ToolRow from './ToolRow.vue'
import ResultPane from './ResultPane.vue'
import { useToolStatus } from '../../../transcript/useToolStatus'
import type { Block } from '../../../transcript/types'
const props = defineProps<{ block: Block; open?: boolean }>()
const { status, result } = useToolStatus(props.block)
const tone = computed(() =>
  status.value === 'err' ? 'err' : status.value === 'running' ? 'run' : 'ok',
)
const inputStr = computed(() => {
  try {
    return JSON.stringify(props.block.input ?? {}, null, 2)
  } catch {
    return ''
  }
})
const brief = computed(() => {
  const i = (props.block.input ?? {}) as Record<string, unknown>
  return String(i.file_path || i.path || i.pattern || i.command || i.url || i.query || '')
})
// 文件类(Write/NotebookEdit 等带文件路径)→ 单独出现时默认展开;其余通用工具默认折叠。
const isFile = computed(() => {
  const i = (props.block.input ?? {}) as Record<string, unknown>
  return !!(i.file_path || i.notebook_path)
})
</script>

<template>
  <ToolRow
    :name="block.name || 'tool'"
    :desc="brief"
    mono
    :tone="tone"
    foldable
    :default-open="open ?? isFile"
  >
    <pre v-if="inputStr && inputStr !== '{}'" class="in">{{ inputStr }}</pre>
    <ResultPane :text="result?.content" :is-error="result?.isError" />
  </ToolRow>
</template>

<style scoped>
.in {
  font-family: var(--vsc-mono);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0 0 6px;
  padding: 7px 10px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 8px;
  color: var(--mut);
  max-height: 200px;
  overflow: auto;
}
</style>
