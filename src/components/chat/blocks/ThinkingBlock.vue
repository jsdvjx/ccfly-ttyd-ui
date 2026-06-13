<script setup lang="ts">
// ThinkingBlock — 暗淡可折叠「Thinking」行(参考里默认只显示这个词,展开看正文)。
import { computed } from 'vue'
import ToolRow from './ToolRow.vue'
const props = defineProps<{ text?: string }>()
const preview = computed(() => (props.text || '').replace(/\s+/g, ' ').trim().slice(0, 80))
</script>

<template>
  <ToolRow name="Thinking" tone="mut" dim foldable :default-open="false" :desc="preview">
    <div class="t">{{ text || '(无内容)' }}</div>
  </ToolRow>
</template>

<style scoped>
.t {
  color: var(--mut);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
