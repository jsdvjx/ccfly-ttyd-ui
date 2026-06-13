<script setup lang="ts">
// ConfirmDialog — 通用确认弹窗(危险操作专用):标题 + 说明 + 取消/确认。
// 取代「点两次确认」的隐式交互;Teleport 到 body,遮罩点击/Esc 均视为取消。
import { onMounted, onUnmounted } from 'vue'

defineProps<{
  title: string
  message: string
  confirmLabel?: string
  busy?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('cancel')
  }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onUnmounted(() => document.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div class="cfm-mask" @click.self="emit('cancel')">
      <div class="cfm" role="alertdialog" aria-modal="true">
        <div class="cfm-hd">{{ title }}</div>
        <p class="cfm-msg">{{ message }}</p>
        <div class="cfm-foot">
          <button class="cfm-k" :disabled="busy" @click="emit('cancel')">取消</button>
          <button class="cfm-k danger" :disabled="busy" @click="emit('confirm')">
            {{ busy ? '执行中…' : confirmLabel || '确认' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cfm-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.cfm {
  width: min(360px, 100%);
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
  padding: 14px;
}
.cfm-hd {
  color: #e5e7eb;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
.cfm-msg {
  color: #9d9d9d;
  font-size: 12.5px;
  line-height: 1.6;
  margin: 0 0 14px;
  word-break: break-word;
}
.cfm-foot {
  display: flex;
  gap: 8px;
}
.cfm-k {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #3a3a3a;
  background: #313131;
  color: #e5e7eb;
  cursor: pointer;
  font-size: 13px;
}
.cfm-k:hover:not(:disabled) {
  border-color: #0078d4;
}
.cfm-k.danger {
  background: #3a2626;
  border-color: #5a3a3a;
  color: #ff9b94;
}
.cfm-k.danger:hover:not(:disabled) {
  border-color: #f85149;
}
.cfm-k:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
