<script setup lang="ts">
// MsgBoundary — 单条消息的错误隔离:一张坏卡片不该让整个 transcript 白屏。
import { ref, onErrorCaptured } from 'vue'
const err = ref('')
onErrorCaptured((e) => {
  err.value = String(e)
  return false
})
</script>

<template>
  <div v-if="err" class="be">⚠ 渲染出错:{{ err }}</div>
  <slot v-else />
</template>

<style scoped>
.be {
  color: var(--red);
  font-size: 11px;
  padding: 4px 10px;
}
</style>
