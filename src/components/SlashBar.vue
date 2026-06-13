<script setup lang="ts">
// SlashBar —— 用确认式 sendSlashCommand 跑斜杠命令,展示返回结果。
// /context 走 jsonl(打印型),/cost 走读屏解析(模态浮层)。
import { ref } from 'vue'
import { runContext, runUsage } from '../send/commands'
import { SendError, type SendPhase } from '../send/sendMessage'
import type { SlashDeps } from '../send/sendSlashCommand'
import type { JEvent } from '../state'

const props = defineProps<{
  send: (s: string) => void
  readInput: () => string
  events: () => JEvent[]
  screen: () => string[]
}>()

const running = ref('')
const phase = ref<SendPhase | ''>('')
const result = ref<string>('')
const error = ref('')
let ctrl: AbortController | null = null

function deps(): SlashDeps {
  // ctrl 由 run() 建好,这里只读 signal(对齐 InputBridge,避免 abort 作用到错的命令)。
  return {
    send: props.send,
    readInput: props.readInput,
    events: props.events,
    screen: props.screen,
    signal: ctrl?.signal,
    onPhase: (p) => (phase.value = p),
  }
}

function abort() {
  ctrl?.abort()
}

async function run(name: string, fn: () => Promise<unknown>) {
  if (running.value) return
  running.value = name
  error.value = ''
  result.value = ''
  phase.value = 'clear'
  ctrl = new AbortController()
  try {
    const r = await fn()
    result.value = Array.isArray(r) ? (r as string[]).join('\n') : String(r)
  } catch (e) {
    error.value = e instanceof SendError ? `[${e.step}] ${e.message}` : String(e)
  } finally {
    running.value = ''
    phase.value = ''
    ctrl = null
  }
}
</script>

<template>
  <div class="slash">
    <div class="hd">
      <span>slash 命令(确认式 · 有返回)</span>
      <span v-if="running" class="ph">{{ running }} · {{ phase }}…</span>
      <button v-if="running" class="x" @click="abort">打断</button>
    </div>
    <div class="btns">
      <button class="b" :disabled="!!running" @click="run('/context', () => runContext(deps()))">
        /context
      </button>
      <button class="b" :disabled="!!running" @click="run('/usage', () => runUsage(deps()))">
        /usage
      </button>
    </div>
    <pre v-if="result" class="out">{{ result }}</pre>
    <div v-if="error" class="err">✗ {{ error }}</div>
  </div>
</template>

<style scoped>
.slash {
  padding: 10px 12px;
  border-bottom: 1px solid #1f2630;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hd span:first-child {
  color: #e5e7eb;
  font-weight: 700;
  font-size: 13px;
}
.ph {
  color: #f59e0b;
  font-size: 11px;
}
.x {
  background: #7f1d1d;
  color: #fecaca;
  border: 0;
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.btns {
  display: flex;
  gap: 8px;
}
.b {
  background: #1f2937;
  color: #cbd5e1;
  border: 0;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.b:disabled {
  opacity: 0.5;
  cursor: default;
}
.out {
  margin: 0;
  background: #0b0e14;
  color: #93c5fd;
  font-size: 11px;
  line-height: 1.35;
  padding: 8px;
  border-radius: 6px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.err {
  color: #f87171;
  font-size: 12px;
  background: #1f1416;
  border: 1px solid #5b1d1d;
  border-radius: 6px;
  padding: 6px 8px;
}
</style>
