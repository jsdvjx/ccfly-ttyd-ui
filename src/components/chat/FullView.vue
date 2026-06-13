<script setup lang="ts">
// FullView — 全屏查看 overlay:按 kind 渲染 图片 / diff / 代码。ESC 或点背景/✕ 关闭。
// 放在 .ccfly-chat 内(fixed 覆盖视口,继承主题变量);CodeView/DiffView 传 full → 不再显示自己的「全屏」按钮、放开高度。
import { onMounted, onUnmounted } from 'vue'
import CodeView from './blocks/CodeView.vue'
import DiffView from './blocks/DiffView.vue'
import type { FullPayload } from './fullview'
const props = defineProps<{ payload: FullPayload | null }>()
const emit = defineEmits<{ close: [] }>()
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.payload) emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="payload" class="fv" @click.self="emit('close')">
    <div class="fvbar">
      <span class="fvt">{{
        payload.title ||
        (payload.kind === 'image' ? '图片' : payload.kind === 'diff' ? '改动' : '文件')
      }}</span>
      <button class="fvx" title="关闭 (Esc)" @click="emit('close')">✕</button>
    </div>
    <div class="fvbody" @click.self="emit('close')">
      <img v-if="payload.kind === 'image'" :src="payload.src" class="fvimg" alt="" />
      <DiffView v-else-if="payload.kind === 'diff'" :hunks="payload.hunks || []" full />
      <CodeView v-else :code="payload.code" :lang="payload.lang" full />
    </div>
  </div>
</template>

<style scoped>
.fv {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.82);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  padding: 14px;
}
.fvbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 4px 10px;
}
.fvt {
  color: var(--fg);
  font-size: 13px;
  font-family: var(--vsc-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fvx {
  margin-left: auto;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--bd);
  background: var(--card);
  color: var(--fg);
  cursor: pointer;
  font-size: 14px;
}
.fvx:hover {
  border-color: var(--acc);
}
.fvbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain; /* 同 transcript:滚动不外传 */
  display: flex;
  justify-content: center;
}
.fvbody > * {
  margin: auto;
  max-width: 1100px;
  width: 100%;
}
.fvimg {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  margin: auto;
  object-fit: contain;
  border-radius: 6px;
}
</style>
