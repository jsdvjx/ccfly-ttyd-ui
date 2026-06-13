<script setup lang="ts">
// SessionList — 左栏会话列表;点选 emit('select', sid)。
import type { SessionMeta } from '../composables/useSessions'

defineProps<{ sessions: SessionMeta[]; selected: string }>()
const emit = defineEmits<{ select: [sid: string] }>()

const stateColor: Record<string, string> = {
  working: '#f59e0b',
  idle: '#22c55e',
}
const ago = (s: number): string =>
  s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
</script>

<template>
  <nav class="sl">
    <div class="hd">sessions ({{ sessions.length }})</div>
    <button
      v-for="s in sessions"
      :key="s.session_id"
      class="item"
      :class="{ sel: s.session_id === selected }"
      @click="emit('select', s.session_id)"
    >
      <span class="dot" :class="{ live: s.live }" :style="{ background: stateColor[s.state] }" />
      <span class="body">
        <span class="title">{{ s.title || s.session_id.slice(0, 8) }}</span>
        <span class="meta">{{ s.model || '?' }} · {{ s.state }} · {{ ago(s.age_sec) }}</span>
        <span class="cwd">{{ s.cwd.replace(/^.*\//, '') }}</span>
      </span>
    </button>
  </nav>
</template>

<style scoped>
.sl {
  width: 220px;
  flex: none;
  overflow: auto;
  background: #0d1118;
  border-right: 1px solid #1f2630;
  display: flex;
  flex-direction: column;
}
.hd {
  padding: 8px 12px;
  color: #9ca3af;
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid #1f2630;
}
.item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  text-align: left;
  background: none;
  border: 0;
  border-bottom: 1px solid #161b24;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
}
.item:hover {
  background: #11161f;
}
.item.sel {
  background: #16243a;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 4px;
  background: #475569;
  flex: none;
  opacity: 0.5;
}
.dot.live {
  opacity: 1;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.title {
  color: #e5e7eb;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 170px;
}
.meta {
  color: #64748b;
  font-size: 10.5px;
}
.cwd {
  color: #475569;
  font-size: 10px;
  font-family: monospace;
}
</style>
