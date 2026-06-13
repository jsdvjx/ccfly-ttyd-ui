<script setup lang="ts">
import type { SessionState } from '../state'

defineProps<{ state: SessionState; eventCount: number }>()

const color: Record<string, string> = {
  offline: '#6b7280',
  select: '#3b82f6',
  idle: '#22c55e',
  generating: '#f59e0b',
  'awaiting-tool': '#a855f7',
  usage: '#06b6d4',
  help: '#14b8a6',
  status: '#0ea5e9',
  config: '#8b5cf6',
  stats: '#ec4899',
  mcp: '#10b981',
  plugin: '#eab308',
  unknown: '#ef4444',
}
</script>

<template>
  <div class="sp">
    <div class="status" :style="{ background: color[state.status] || '#475569' }">
      {{ state.status }}
      <small>via {{ state.source }}</small>
    </div>

    <dl class="kv">
      <dt>mode</dt>
      <dd>{{ state.mode ?? '—' }}</dd>
      <dt>permission</dt>
      <dd>{{ state.permissionMode ?? '—' }}</dd>
      <dt>title</dt>
      <dd>{{ state.title ?? '—' }}</dd>
      <dt>tasks</dt>
      <dd>
        {{
          state.tasks.length
            ? state.tasks.filter((t) => t.status === 'completed').length + '/' + state.tasks.length
            : '—'
        }}
      </dd>
      <dt>agents</dt>
      <dd>{{ state.pendingAgents }}</dd>
      <dt>workflows</dt>
      <dd>{{ state.pendingWorkflows }}</dd>
      <dt>interrupted</dt>
      <dd :class="{ hot: state.interrupted }">{{ state.interrupted }}</dd>
      <dt>apiError</dt>
      <dd :class="{ hot: !!state.apiError }">
        {{
          state.apiError ? (state.apiError.status || '') + ' ' + (state.apiError.error || '') : '—'
        }}
      </dd>
      <dt>suggest</dt>
      <dd class="mono">{{ state.suggest ?? '—' }}</dd>
      <dt>lastActivity</dt>
      <dd class="mono">{{ state.lastActivity ? state.lastActivity.slice(11, 19) : '—' }}</dd>
      <dt>jsonl events</dt>
      <dd class="mono">{{ eventCount }}</dd>
    </dl>
  </div>
</template>

<style scoped>
.sp {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.status {
  align-self: flex-start;
  color: #0b0e14;
  font-weight: 800;
  font-size: 18px;
  padding: 6px 16px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.status small {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
  margin-left: 8px;
  text-transform: none;
}
.kv {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 6px 10px;
  margin: 0;
  font-size: 13px;
}
.kv dt {
  color: #9ca3af;
  font-weight: 600;
}
.kv dd {
  margin: 0;
  color: #e5e7eb;
  word-break: break-word;
}
.kv dd.hot {
  color: #f87171;
  font-weight: 700;
}
.kv dd.mono {
  font-family: Menlo, Consolas, monospace;
  color: #94a3b8;
}
</style>
