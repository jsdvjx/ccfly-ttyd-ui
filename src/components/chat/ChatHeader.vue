<script setup lang="ts">
// ChatHeader — 会话信息条(只剩标题)。连接状态在外层 Workspace 顶栏(icon);
// 权限模式/运行态聚合到底部输入框(ChatComposer),这里不重复。
import type { SessionState } from '../../state'
defineProps<{ state: SessionState }>()
</script>

<template>
  <header class="ch">
    <span class="title">{{ state.title || '(会话)' }}</span>
  </header>
</template>

<style scoped>
.ch {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--bd);
  background: var(--bg2);
  flex: none;
}
.title {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
