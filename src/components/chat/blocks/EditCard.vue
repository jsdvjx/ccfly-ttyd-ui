<script setup lang="ts">
// EditCard — Edit/MultiEdit:时间线行 + 结构化 diff(有 structuredPatch 时);否则退回 旧/新 两段。
import { computed } from 'vue'
import ToolRow from './ToolRow.vue'
import DiffView from './DiffView.vue'
import CodeView from './CodeView.vue'
import { useToolStatus } from '../../../transcript/useToolStatus'
import { langFromPath } from '../../../highlight'
import type { Block } from '../../../transcript/types'
const props = defineProps<{ block: Block; open?: boolean }>()
const { status, result } = useToolStatus(props.block)
const path = computed(() => (props.block.input?.file_path as string) ?? '')
const base = computed(() => path.value.split('/').pop() || path.value)
const lang = computed(() => langFromPath(path.value))
const tone = computed(() =>
  status.value === 'err' ? 'err' : status.value === 'running' ? 'run' : 'ok',
)
const hunks = computed(() => result.value?.patch) // 来自 structuredPatch(toItems 贴上)
const oldS = computed(() => (props.block.input?.old_string as string) ?? '')
const newS = computed(() => (props.block.input?.new_string as string) ?? '')
</script>

<template>
  <ToolRow name="Edit" :desc="base" mono :tone="tone" foldable :default-open="open ?? true">
    <DiffView v-if="hunks && hunks.length" :hunks="hunks" :title="base" />
    <template v-else>
      <div class="lbl del">− 原</div>
      <CodeView :code="oldS" :lang="lang" :title="base" />
      <div class="lbl add">+ 新</div>
      <CodeView :code="newS" :lang="lang" :title="base" />
    </template>
  </ToolRow>
</template>

<style scoped>
.lbl {
  font-size: 11px;
  margin: 4px 0 2px;
}
.lbl.del {
  color: #ffa198;
}
.lbl.add {
  color: #7ee787;
}
</style>
