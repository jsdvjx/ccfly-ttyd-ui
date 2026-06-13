<script setup lang="ts">
// ResultPane — 工具结果文本(等宽,错误标红)。
defineProps<{ text?: string; isError?: boolean }>()
</script>

<template>
  <pre v-if="text" class="res" :class="{ err: isError }">{{ text }}</pre>
</template>

<style scoped>
.res {
  font-family: var(--vsc-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 4px 0 0;
  padding: 6px 8px;
  background: #181818;
  border: 1px solid var(--bd);
  border-radius: 6px;
  max-height: 340px;
  overflow: auto;
  color: var(--mut);
}
.res.err {
  color: var(--red);
  border-color: #5a2a2a;
}
</style>
