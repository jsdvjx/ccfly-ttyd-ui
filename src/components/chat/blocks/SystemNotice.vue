<script setup lang="ts">
// SystemNotice — 暗淡系统/伪用户提示(task-notification / command / system-reminder / interrupted 等)。
import type { Item } from '../../../transcript/types'
defineProps<{ item: Item }>()
</script>

<template>
  <div class="sys">
    <span class="k">{{ item.kind || 'system' }}</span>
    <span class="tx">{{ (item.text || '').slice(0, 600) }}</span>
  </div>
</template>

<style scoped>
.sys {
  color: var(--mut);
  font-size: 11.5px;
  padding: 3px 10px;
  border-left: 2px solid var(--bd);
  margin: 3px 0;
  font-family: var(--vsc-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.k {
  color: #888;
  margin-right: 6px;
}
</style>
