<script setup lang="ts">
// Workspace — 单节点会话工作区(对话视图)。webui 固定为 chat:终端隐藏在屏外,仅用于发送/读状态;
// 不再有 终端/重连 按钮与会话列表(重连改为自动:见 useTerminalSession;选会话走 hub 的会话卡/深链)。
import { ref, computed, watch, provide, onMounted, onUnmounted } from 'vue'
import { useTerminalSession, type ViewMode } from './composables/useTerminalSession'
import { useTranscript } from './transcript/useTranscript'
import { RESULT_KEY } from './transcript/useToolStatus'
import ChatView from './ChatView.vue'
import SessionsPanel from './components/SessionsPanel.vue'
import NewSessionDialog from './components/NewSessionDialog.vue'

const props = defineProps<{ initialSid?: string; back?: boolean; deviceLabel?: string }>()
const emit = defineEmits<{ back: []; navigate: [sid: string] }>()

const showNew = ref(false)

const mode = ref<ViewMode>('chat') // 固定对话视图
const termEl = ref<HTMLElement | null>(null)
const sess = useTerminalSession(termEl, mode)
const {
  sessions,
  selSid,
  connected,
  jsonlConnected,
  termless,
  resolvedPath,
  events,
  state,
  send,
  ensureLive,
  readInput,
  getEvents,
  getScreen,
  reconnectAll,
  takeover,
  hasMoreOlder,
  loadingOlder,
  loadOlder,
} = sess
const { resultById, turns } = useTranscript(events)
provide(RESULT_KEY, resultById)

// 当前会话所在目录(会话面板按它过滤同目录会话)
const curCwd = computed(
  () => sessions.value.find((s) => s.session_id === selSid.value)?.cwd ?? '',
)

if (props.initialSid) selSid.value = props.initialSid // hub 深链:预选会话
watch(selSid, (sid) => {
  if (sid) emit('navigate', sid) // 选中变化 → 同步 URL(hub)
})

// 新建会话拿到真 sid → 切到它(selSid 变化自动重连 + 同步 URL),与点选已有会话同一路径。
function onCreated(sid: string): void {
  showNew.value = false
  selSid.value = sid
}

// 移动端软键盘/地址栏:把 .app 高度钉到 visualViewport 的可见高度,键盘弹起时整页收缩到键盘上方,
// 浮动输入框(absolute 贴 .app 底)自然贴在键盘之上。iOS 弹键盘还会把页面整体向上「平移」
// (vv.offsetTop > 0)而非缩短布局视口 —— 不补偿的话 .app 顶部被推出屏外、底部露出一条页外空白,
// 所以再用 translateY 把 .app 拉回可见区。双指缩放(scale≠1)时 vv.height 是缩放后的值,不干预。
const appEl = ref<HTMLElement | null>(null)
function syncViewport(): void {
  const vv = window.visualViewport
  const el = appEl.value
  if (!vv || !el) return
  if (vv.scale && Math.abs(vv.scale - 1) > 0.01) return
  el.style.height = vv.height + 'px'
  el.style.transform = vv.offsetTop > 0 ? `translateY(${vv.offsetTop}px)` : ''
}
onMounted(() => {
  window.visualViewport?.addEventListener('resize', syncViewport)
  window.visualViewport?.addEventListener('scroll', syncViewport)
  syncViewport()
})
onUnmounted(() => {
  window.visualViewport?.removeEventListener('resize', syncViewport)
  window.visualViewport?.removeEventListener('scroll', syncViewport)
})
</script>

<template>
  <div ref="appEl" class="app">
    <header class="bar">
      <button v-if="props.back" class="back" title="返回" @click="emit('back')">←</button>
      <span class="logo">{{ props.deviceLabel || 'ccfly' }}</span>
      <!-- 连接状态 icon:>_ 终端通道(ws)、{} 事件流(jsonl);绿=已连。比两个同样的圆点更易区分。 -->
      <span
        class="conn"
        :class="{ on: connected }"
        :title="'终端通道(ws):' + (connected ? '已连接' : '未连接')"
        >&gt;_</span
      >
      <span
        class="conn"
        :class="{ on: jsonlConnected }"
        :title="'事件流(jsonl):' + (jsonlConnected ? '已连接' : '未连接')"
        >{}</span
      >
      <span class="path" :title="resolvedPath">{{ resolvedPath }}</span>
      <!-- 新建会话:打开目录浏览器 → 在选定目录起全新 claude → 切到它 -->
      <button class="newbtn" title="新建会话(选目录)" @click="showNew = true">＋<span class="nb-t"> 新建</span></button>
      <!-- 本目录会话面板:列出当前 cwd 下全部会话,点选快速跳转(selSid 变化会自动重连+同步 URL) -->
      <SessionsPanel
        :sessions="sessions"
        :sid="selSid"
        :cwd="curCwd"
        @select="(id) => (selSid = id)"
      />
    </header>

    <NewSessionDialog v-if="showNew" @created="onCreated" @close="showNew = false" />

    <main class="body">
      <!-- 隐藏终端:始终挂载、移屏外(仅发送/读状态;不能 display:none,否则 fit 退化、检测器失灵)。 -->
      <section class="termwrap">
        <div ref="termEl" class="term" />
      </section>

      <ChatView
        class="chatmain"
        :turns="turns"
        :sid="selSid"
        :state="state"
        :connected="connected"
        :jsonl-connected="jsonlConnected"
        :termless="termless"
        :reconnect-all="reconnectAll"
        :takeover="takeover"
        :send="send"
        :ensure-live="ensureLive"
        :read-input="readInput"
        :get-events="getEvents"
        :get-screen="getScreen"
        :has-more-older="hasMoreOlder"
        :loading-older="loadingOlder"
        :load-older="loadOlder"
      />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  /* 填满 #app(唯一视口盒),不再用 100vh/100dvh:那会比 svh 高度的祖先更高,
     地址栏一收起文档就真的可滚 → 整页能被拽出空地。 */
  height: 100%;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: #11151c;
  border-bottom: 1px solid #1f2630;
  flex: none;
  /* 防御:header 是固定按钮 + 可伸缩文本的混排,min-width:0 让它绝不被内部
     min-content 撑超视口宽(否则窄屏多一个 ＋新建 就溢出 → 横向滚动条)。 */
  min-width: 0;
}
.back {
  background: #1f2937;
  color: #fff;
  border: 0;
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 13px;
  flex: none;
}
.logo {
  font-weight: 700;
  color: #e5e7eb;
  /* 主机名过长时截断而非撑破 header(min-width:0 才能在 flex 里真正收缩)。 */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.newbtn {
  background: #16653a;
  color: #d1fae5;
  border: 1px solid #1f7a47;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  flex: none;
}
.conn {
  font-family: var(--vsc-mono, ui-monospace, monospace);
  font-size: 9px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 5px;
  border: 1px solid #2a3441;
  color: #6b7280;
  flex: none;
  user-select: none;
  cursor: default;
}
.conn.on {
  color: #22c55e;
  border-color: #22c55e55;
  background: #22c55e14;
}
.path {
  margin-left: auto;
  color: #475569;
  font-size: 10.5px;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 55%;
  /* 空间不足时可一路收缩到 0(配合 ellipsis),把宽度让给固定按钮。 */
  min-width: 0;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
/* 隐藏终端固定移屏外:仅作发送/读状态通道,不可见、不占布局。 */
.termwrap {
  position: absolute;
  left: -99999px;
  top: 0;
  width: 900px;
  height: 640px;
  pointer-events: none;
}
.term {
  width: 100%;
  height: 100%;
}
.chatmain {
  flex: 1;
  min-width: 0;
}
/* 窄屏(手机)header 瘦身:路径次要先隐藏,＋新建 收成纯「＋」图标,
   给固定按钮(返回/连接态/会话面板)与完整主机名腾足空间,根除横向滚动条。
   宽屏不受影响,照常显示完整「＋ 新建」与路径。 */
@media (max-width: 480px) {
  .path {
    display: none;
  }
  .nb-t {
    display: none;
  }
}
</style>
