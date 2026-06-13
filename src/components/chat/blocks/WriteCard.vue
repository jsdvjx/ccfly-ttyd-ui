<script setup lang="ts">
// WriteCard — Write:文件名 + 写入内容(按文件类型代码高亮),而不是把 {file_path,content} 当 JSON 一坨打印。
// 文件类:单独出现时默认展开。
import { computed } from 'vue'
import ToolRow from './ToolRow.vue'
import CodeView from './CodeView.vue'
import { useToolStatus } from '../../../transcript/useToolStatus'
import { langFromPath } from '../../../highlight'
import type { Block } from '../../../transcript/types'
const props = defineProps<{ block: Block; open?: boolean }>()
const { status } = useToolStatus(props.block)
const path = computed(() => (props.block.input?.file_path as string) ?? '')
const base = computed(() => path.value.split('/').pop() || path.value)
const lang = computed(() => langFromPath(path.value))
const content = computed(() => (props.block.input?.content as string) ?? '')
const tone = computed(() =>
  status.value === 'err' ? 'err' : status.value === 'running' ? 'run' : 'ok',
)
</script>

<template>
  <ToolRow name="Write" :desc="base" mono :tone="tone" foldable :default-open="open ?? true">
    <CodeView v-if="content" :code="content" :lang="lang" :title="path" />
    <span v-else class="m">(空文件)</span>
  </ToolRow>
</template>

<style scoped>
.m {
  color: var(--mut);
  font-size: 12px;
}
</style>
