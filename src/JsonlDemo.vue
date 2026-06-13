<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

interface Row {
  offset: number
  type: string
  timestamp: string
  raw: string
}

const path = ref('') // 空 = 服务端挑最新 jsonl
const connected = ref(false)
const rows = ref<Row[]>([])
const metaPath = ref('')
const listEl = ref<HTMLElement | null>(null)
const autoscroll = ref(true)

let es: EventSource | null = null

function connect() {
  es?.close()
  rows.value = []
  const q = path.value.trim() ? '?path=' + encodeURIComponent(path.value.trim()) : ''
  es = new EventSource('/sse/jsonl' + q)

  es.addEventListener('meta', (e) => {
    try {
      metaPath.value = JSON.parse((e as MessageEvent).data).path
    } catch {
      /* ignore */
    }
  })
  es.onopen = () => (connected.value = true)
  es.onerror = () => (connected.value = false) // EventSource 自动重连(带 Last-Event-ID 续传)
  es.onmessage = (e) => {
    let type = '?'
    let timestamp = ''
    try {
      const o = JSON.parse(e.data)
      type = o.type ?? '?'
      timestamp = o.timestamp ?? ''
    } catch {
      /* 非 JSON:照样显示原文 */
    }
    rows.value.push({ offset: Number(e.lastEventId), type, timestamp, raw: e.data })
    if (autoscroll.value) {
      nextTick(() => {
        if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
      })
    }
  }
}

function disconnect() {
  es?.close()
  es = null
  connected.value = false
}

const typeColor: Record<string, string> = {
  user: '#22c55e',
  assistant: '#3b82f6',
  system: '#a78bfa',
  attachment: '#f59e0b',
  'file-history-snapshot': '#64748b',
  mode: '#64748b',
  'permission-mode': '#64748b',
  'ai-title': '#64748b',
  'last-prompt': '#64748b',
  'queue-operation': '#64748b',
}

onMounted(connect)
onUnmounted(disconnect)
</script>

<template>
  <div class="app">
    <header class="bar">
      <span class="logo">jsonl SSE</span>
      <input
        v-model="path"
        class="url"
        spellcheck="false"
        placeholder="(空=最新 jsonl) 或粘贴绝对路径"
        @keyup.enter="connect"
      />
      <button class="btn" @click="connect">connect</button>
      <button class="btn ghost" @click="disconnect">stop</button>
      <span class="dot" :class="{ on: connected }" />
      <span class="count">{{ rows.length }} lines</span>
      <label class="chk"><input v-model="autoscroll" type="checkbox" /> autoscroll</label>
    </header>
    <div v-if="metaPath" class="meta">{{ metaPath }}</div>

    <main ref="listEl" class="list">
      <details v-for="(r, i) in rows" :key="i" class="row">
        <summary>
          <span class="off">#{{ r.offset }}</span>
          <span class="type" :style="{ background: typeColor[r.type] || '#475569' }">{{
            r.type
          }}</span>
          <span class="ts">{{ r.timestamp }}</span>
        </summary>
        <pre class="raw">{{ r.raw }}</pre>
      </details>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%; /* 填满 #app(文档已锁滚,见 style.css) */
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #11151c;
  border-bottom: 1px solid #1f2630;
}
.logo {
  font-weight: 700;
  color: #e5e7eb;
}
.url {
  flex: 1;
  max-width: 560px;
  background: #0b0e14;
  color: #e5e7eb;
  border: 1px solid #1f2630;
  border-radius: 6px;
  padding: 6px 10px;
  font-family: monospace;
  font-size: 13px;
}
.btn {
  background: #2563eb;
  color: #fff;
  border: 0;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.btn.ghost {
  background: #1f2937;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #6b7280;
}
.dot.on {
  background: #22c55e;
}
.count {
  color: #9ca3af;
  font-size: 12px;
  font-family: monospace;
}
.chk {
  color: #6b7280;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.meta {
  padding: 4px 12px;
  color: #64748b;
  font-size: 11px;
  font-family: monospace;
  border-bottom: 1px solid #1f2630;
  word-break: break-all;
}
.list {
  flex: 1;
  overflow: auto;
  padding: 6px 10px;
}
.row {
  border-bottom: 1px solid #161b24;
}
.row summary {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 4px 2px;
  cursor: pointer;
  font-family: monospace;
  font-size: 12px;
}
.off {
  color: #475569;
  min-width: 80px;
}
.type {
  color: #0b0e14;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 4px;
  min-width: 90px;
  text-align: center;
}
.ts {
  color: #94a3b8;
}
.raw {
  margin: 4px 0 8px 0;
  padding: 8px;
  background: #0b0e14;
  color: #cbd5e1;
  font-size: 11px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
}
</style>
