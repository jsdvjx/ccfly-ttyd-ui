<script setup lang="ts">
// BashCard — Bash / BashOutput:时间线行 +「IN / OUT」代码框(参考样式)。命令不换行(横向裁剪),输出折行可滚。
import { computed } from 'vue'
import ToolRow from './ToolRow.vue'
import { useToolStatus } from '../../../transcript/useToolStatus'
import { hl } from '../../../highlight'
import type { Block } from '../../../transcript/types'
// open:在「展开的多工具组」里 = true(顶层展开则子项全展开);单独出现时不传 → 用类型默认(Bash 折叠)。
const props = defineProps<{ block: Block; open?: boolean }>()
const { status, result } = useToolStatus(props.block)
const cmd = computed(() => (props.block.input?.command as string) ?? '')
const cmdHtml = computed(() => hl(cmd.value, 'bash'))
const desc = computed(() => (props.block.input?.description as string) ?? '')
const tone = computed(() =>
  status.value === 'err' ? 'err' : status.value === 'running' ? 'run' : 'ok',
)
const out = computed(() => result.value?.content ?? '')
</script>

<template>
  <ToolRow name="Bash" :desc="desc || cmd" :tone="tone" foldable :default-open="open ?? false">
    <div class="iobox">
      <div v-if="cmd" class="ioln">
        <span class="iolb">IN</span>
        <pre class="iotx cmd hljs" v-html="cmdHtml" />
      </div>
      <div v-if="status === 'running'" class="ioln">
        <span class="iolb">··</span><span class="run">运行中…</span>
      </div>
      <div v-else-if="out" class="ioln">
        <span class="iolb">OUT</span>
        <pre class="iotx out" :class="{ err: result?.isError }">{{ out }}</pre>
      </div>
    </div>
  </ToolRow>
</template>

<style scoped>
.iobox {
  border: 1px solid var(--bd);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg2);
}
.ioln {
  display: flex;
  gap: 10px;
  padding: 7px 10px;
}
.ioln + .ioln {
  border-top: 1px solid var(--bd);
}
.iolb {
  width: 30px;
  flex: none;
  color: #6e6e6e;
  font-size: 10px;
  font-weight: 600;
  padding-top: 2px;
  letter-spacing: 0.5px;
}
.iotx {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-family: var(--vsc-mono);
  font-size: 12px;
  line-height: 1.5;
}
.iotx.cmd {
  color: #d4d4d4;
  white-space: pre;
  overflow-x: auto;
}
.iotx.out {
  color: var(--mut);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
.iotx.out.err {
  color: #ff9b94;
}
.run {
  color: var(--amber);
  font-size: 12px;
}
</style>
