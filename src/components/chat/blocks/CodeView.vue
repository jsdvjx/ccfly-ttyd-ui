<script setup lang="ts">
// CodeView — 代码块:highlight.js 按语言上色(lang 由调用方按文件名推断;未知则纯文本)。
// 行数超阈值才给「全屏」按钮(避免到处是按钮);full=true 时为全屏模式:不再给按钮、放开高度。
import { computed } from 'vue'
import { hl } from '../../../highlight'
import { useFullView } from '../fullview'
const props = defineProps<{ code?: string; lang?: string | null; title?: string; full?: boolean }>()
const raw = computed(() => (props.code ?? '').replace(/\n$/, ''))
const html = computed(() => hl(raw.value, props.lang))
const lineCount = computed(() => (raw.value ? raw.value.split('\n').length : 0))
const FULL_LINES = 24
const canFull = computed(() => !props.full && lineCount.value > FULL_LINES)
const openFull = useFullView()
</script>

<template>
  <div class="cw">
    <button
      v-if="canFull"
      class="fullbtn"
      title="全屏查看"
      @click="openFull({ kind: 'code', code: raw, lang, title })"
    >
      ⤢ 全屏
    </button>
    <pre class="code hljs" :class="{ full }"><code v-html="html" /></pre>
  </div>
</template>

<style scoped>
.cw {
  position: relative;
}
.fullbtn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--bd);
  background: #2a2a2acc;
  color: var(--mut);
  cursor: pointer;
}
.fullbtn:hover {
  color: var(--fg);
  border-color: var(--acc);
}
.code {
  font-family: var(--vsc-mono);
  font-size: 12.5px;
  line-height: 1.5;
  background: #181818;
  border: 1px solid var(--bd);
  border-radius: 6px;
  overflow: auto;
  max-height: 420px;
  margin: 0;
  padding: 8px 10px;
  white-space: pre;
  color: #d4d4d4;
}
.code.full {
  max-height: none;
}
.code code {
  font-family: inherit;
}
</style>
