<script setup lang="ts">
// ChatView — chat 页(纯展示):头 + transcript + composer。数据(turns/state/send 等)由 Workspace
// 经 useTerminalSession + useTranscript 算好传入;resultById 由 Workspace provide,卡片自行 inject。
import { ref, provide } from 'vue'
import type { SessionState, JEvent } from './state'
import type { Turn } from './transcript/types'
import ChatHeader from './components/chat/ChatHeader.vue'
import Transcript from './components/chat/Transcript.vue'
import ChatComposer from './components/chat/ChatComposer.vue'
import FullView from './components/chat/FullView.vue'
import { FULLVIEW_KEY, type FullPayload } from './components/chat/fullview'
defineProps<{
  turns: Turn[]
  sid: string
  state: SessionState
  connected: boolean
  jsonlConnected: boolean
  termless: boolean
  reconnectAll: () => void
  takeover: () => Promise<void>
  send: (s: string) => void
  ensureLive: () => Promise<void>
  readInput: () => string
  getEvents: () => JEvent[]
  getScreen: () => string[]
  hasMoreOlder: boolean
  loadingOlder: boolean
  loadOlder: () => Promise<void>
}>()

// 全屏查看器:provide open() 给各卡;本组件挂一个 FullView 读状态。
const full = ref<FullPayload | null>(null)
provide(FULLVIEW_KEY, (p: FullPayload) => {
  full.value = p
})
</script>

<template>
  <div class="ccfly-chat">
    <ChatHeader :state="state" />
    <Transcript
      :turns="turns"
      :sid="sid"
      :has-more-older="hasMoreOlder"
      :loading-older="loadingOlder"
      :load-older="loadOlder"
    />
    <!-- 浮动输入框(参照 VSCode):悬于 transcript 之上、居中、限宽;空白处不挡点击。 -->
    <div class="composer-float">
      <ChatComposer
        :sid="sid"
        :send="send"
        :ensure-live="ensureLive"
        :read-input="readInput"
        :get-events="getEvents"
        :get-screen="getScreen"
        :state="state"
        :connected="connected"
        :jsonl-connected="jsonlConnected"
        :termless="termless"
        :reconnect-all="reconnectAll"
        :takeover="takeover"
      />
    </div>
    <FullView :payload="full" @close="full = null" />
  </div>
</template>

<style scoped>
.ccfly-chat {
  position: relative;
}
.composer-float {
  position: absolute;
  z-index: 10; /* 盖过 transcript 里的 rail 节点圆点(z-index:1),否则圆点穿透浮窗 */
  left: 0;
  right: 0;
  bottom: calc(14px + env(safe-area-inset-bottom)); /* 避开 home indicator;底部留深色,不露白 */
  padding: 0 16px;
  display: flex;
  justify-content: center;
  pointer-events: none; /* 浮层空白区放行点击/滚动到下面的 transcript */
  will-change: transform;
}
.composer-float > * {
  pointer-events: auto;
  width: 100%;
  max-width: 760px;
}
/* 给 transcript 末尾留出浮动框的空间,最后一条不被遮住 */
.ccfly-chat :deep(.scroll) {
  padding-bottom: 96px;
}
@media (max-width: 600px) {
  .composer-float {
    bottom: calc(8px + env(safe-area-inset-bottom));
    padding: 0 10px;
  }
  .ccfly-chat :deep(.scroll) {
    padding-bottom: 88px;
  }
}
</style>
