<script setup lang="ts">
// SessionsPanel — 顶栏右侧按钮 + 下拉面板:列出「当前目录(cwd)」下的全部 claude 会话,点击快速跳转。
// 数据复用 useSessions 的 /sessions 轮询结果(由 Workspace 传入),不自己拉。
import { ref, computed } from 'vue'
import type { SessionMeta } from '../composables/useSessions'

const props = defineProps<{ sessions: SessionMeta[]; sid: string; cwd: string }>()
const emit = defineEmits<{ select: [sid: string] }>()

const open = ref(false)

// 同目录会话,活的在前,再按 age 新→旧;无 cwd(未选会话/老节点)退化为全部。
const list = computed(() => {
  const all = props.cwd ? props.sessions.filter((s) => s.cwd === props.cwd) : props.sessions
  return [...all].sort((a, b) => Number(b.live) - Number(a.live) || a.age_sec - b.age_sec)
})

function fmtAge(sec: number): string {
  if (sec < 60) return '刚刚'
  if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前'
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前'
  return Math.floor(sec / 86400) + ' 天前'
}

function pick(id: string): void {
  open.value = false
  if (id !== props.sid) emit('select', id)
}
</script>

<template>
  <div class="sp">
    <button
      class="btn"
      :class="{ active: open }"
      :title="'本目录会话(' + list.length + ')'"
      @click="open = !open"
    >
      ☰ {{ list.length }}
    </button>
    <Teleport to="body">
      <div v-if="open" class="sp-backdrop" @click="open = false" />
    </Teleport>
    <div v-if="open" class="panel">
      <div class="head">{{ cwd || '全部会话' }}</div>
      <div v-if="!list.length" class="empty">(无会话)</div>
      <button
        v-for="s in list"
        :key="s.session_id"
        class="item"
        :class="{ cur: s.session_id === sid }"
        @click="pick(s.session_id)"
      >
        <span class="dot" :class="{ live: s.live, working: s.state === 'working' }" />
        <span class="t">
          <span class="title">{{ s.title || s.session_id.slice(0, 8) }}</span>
          <span class="meta"
            >{{ fmtAge(s.age_sec) }} · {{ s.turns }} 轮<template v-if="!s.live">
              · 只读</template
            ></span
          >
        </span>
        <span v-if="s.session_id === sid" class="cur-tag">当前</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sp {
  position: relative;
  flex: none;
}
.btn {
  background: transparent;
  color: #9ca3af;
  border: 1px solid #2a3441;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover,
.btn.active {
  color: #e5e7eb;
  background: #1f2937;
}
.sp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}
.panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  width: min(340px, calc(100vw - 24px));
  max-height: min(60vh, 420px);
  overflow-y: auto;
  background: #161b24;
  border: 1px solid #2a3441;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  padding: 6px;
}
.head {
  color: #64748b;
  font-size: 10.5px;
  font-family: monospace;
  padding: 4px 8px 6px;
  border-bottom: 1px solid #1f2630;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl; /* 长路径优先露出尾部 */
  text-align: left;
}
.empty {
  color: #64748b;
  font-size: 12px;
  text-align: center;
  padding: 18px 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 7px 8px;
  cursor: pointer;
  color: #e5e7eb;
}
.item:hover {
  background: #1f2937;
}
.item.cur {
  background: #16243a;
}
.dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4b5563;
}
.dot.live {
  background: #22c55e;
}
.dot.live.working {
  background: #f59e0b;
}
.t {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.title {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 10.5px;
  color: #64748b;
}
.cur-tag {
  flex: none;
  font-size: 10px;
  color: #60a5fa;
  border: 1px solid #60a5fa44;
  border-radius: 4px;
  padding: 1px 5px;
}
</style>
