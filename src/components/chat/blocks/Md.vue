<script setup lang="ts">
// Md — markdown 渲染(html:false,markdown-it 自动转义,内容来自本会话 transcript)。围栏代码块走 highlight.js 上色。
import MarkdownIt from 'markdown-it'
import { computed } from 'vue'
import { hl } from '../../../highlight'
const props = defineProps<{ text?: string }>()
// hl(str, lang) 已处理未知语言(仅转义),故 highlight 回调无需引用 md.utils。
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: (str: string, lang: string): string =>
    `<pre class="hljs"><code>${hl(str, lang)}</code></pre>`,
})
const html = computed(() => md.render(props.text || ''))
</script>

<template>
  <div class="md" v-html="html" />
</template>

<style scoped>
.md {
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}
.md :deep(pre) {
  background: #181818;
  border: 1px solid var(--bd);
  border-radius: 6px;
  padding: 8px 10px;
  overflow: auto;
}
.md :deep(code) {
  font-family: var(--vsc-mono);
  font-size: 12.5px;
}
.md :deep(:not(pre) > code) {
  background: #2a2a2a;
  padding: 1px 5px;
  border-radius: 4px;
}
.md :deep(a) {
  color: var(--vsc-link);
}
.md :deep(p) {
  margin: 0.4em 0;
}
.md :deep(p:first-child) {
  margin-top: 0;
}
.md :deep(p:last-child) {
  margin-bottom: 0;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3) {
  font-size: 14px;
  margin: 0.6em 0 0.3em;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 0.3em 0;
  padding-left: 1.4em;
}
.md :deep(blockquote) {
  border-left: 3px solid var(--bd);
  margin: 0.4em 0;
  padding-left: 10px;
  color: var(--mut);
}
</style>
