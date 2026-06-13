<script setup lang="ts">
// InputBridge —— 表世界输入控件,走「确认式发送」sendMessage:
//   清空→读屏验证空 → 写入→读屏验证内容 → 提交→读 jsonl 验证消息落库。
//   每阶段显示进度;任意阶段超时/打断/出错 → 显示带阶段的明确错误。
import { ref } from 'vue'
import { sendMessage, SendError, type SendPhase } from '../send/sendMessage'
import type { JEvent } from '../state'

const props = defineProps<{
  send: (s: string) => void
  readInput: () => string
  events: () => JEvent[]
}>()

const text = ref('')
const phase = ref<SendPhase | 'idle' | 'error'>('idle')
const error = ref('')
const busy = ref(false)
let ctrl: AbortController | null = null

const PHASE_LABEL: Record<string, string> = {
  clear: '① 清空中…',
  type: '② 写入中…',
  submit: '③ 提交+确认中…',
  done: '✓ 已确认送达',
}

async function run(submit: boolean) {
  if (busy.value) return
  if (submit && !text.value) return
  busy.value = true
  error.value = ''
  phase.value = 'clear'
  ctrl = new AbortController()
  try {
    await sendMessage(text.value, {
      send: props.send,
      readInput: props.readInput,
      events: props.events,
      submit,
      signal: ctrl.signal,
      onPhase: (p) => (phase.value = p),
    })
    if (submit) text.value = ''
    phase.value = 'done'
  } catch (e) {
    phase.value = 'error'
    error.value = e instanceof SendError ? `[${e.step} 阶段] ${e.message}` : String(e)
  } finally {
    busy.value = false
    ctrl = null
  }
}

function abort() {
  ctrl?.abort()
}

function onEnter(e: KeyboardEvent) {
  if (e.isComposing || e.shiftKey) return
  e.preventDefault()
  void run(true)
}
</script>

<template>
  <div class="bridge">
    <div class="hd">
      <span>→ terminal</span>
      <small>确认式发送 · Enter 发送 · Shift+Enter 换行</small>
    </div>
    <textarea
      v-model="text"
      class="ta"
      rows="3"
      spellcheck="false"
      :disabled="busy"
      placeholder="编排内容,Enter 发送 —— 会清空→写入→提交,每步验证…"
      @keydown.enter="onEnter"
    />
    <div class="btns">
      <button class="b send" :disabled="busy" @click="run(true)">发送 ⏎</button>
      <button class="b" :disabled="busy" @click="run(false)">填入(不发送)</button>
      <button v-if="busy" class="b abort" @click="abort">打断</button>
      <span v-if="busy" class="ph">{{ PHASE_LABEL[phase] ?? phase }}</span>
      <span v-else-if="phase === 'done'" class="ok">{{ PHASE_LABEL.done }}</span>
    </div>
    <div v-if="phase === 'error'" class="err">✗ {{ error }}</div>
  </div>
</template>

<style scoped>
.bridge {
  padding: 10px 12px;
  border-bottom: 1px solid #1f2630;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hd {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.hd span {
  color: #e5e7eb;
  font-weight: 700;
  font-size: 13px;
}
.hd small {
  color: #6b7280;
  font-size: 11px;
}
.ta {
  width: 100%;
  resize: vertical;
  background: #0b0e14;
  color: #e5e7eb;
  border: 1px solid #1f2630;
  border-radius: 6px;
  padding: 8px 10px;
  font-family: Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.4;
}
.ta:focus {
  outline: none;
  border-color: #2563eb;
}
.ta:disabled {
  opacity: 0.6;
}
.btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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
.b.send {
  background: #2563eb;
  color: #fff;
  font-weight: 600;
}
.b.abort {
  background: #7f1d1d;
  color: #fecaca;
}
.b:disabled {
  opacity: 0.5;
  cursor: default;
}
.ph {
  color: #f59e0b;
  font-size: 11px;
}
.ok {
  color: #22c55e;
  font-size: 11px;
}
.err {
  color: #f87171;
  font-size: 12px;
  background: #1f1416;
  border: 1px solid #5b1d1d;
  border-radius: 6px;
  padding: 6px 8px;
  word-break: break-word;
}
</style>
