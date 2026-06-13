<script setup lang="ts">
// AllSessions — 跨设备、按 cwd 合并的会话卡片页(首页 /;/sessions 为旧链兼容)。
// 对每台「在线」设备并行 GET /x/<id>/sessions(同 DeviceView 用的实时网关),给每条会话打来源设备
// 标签,再按「cwd 原文完全相等」分组成卡片。离线设备的缓存接口形状不同,本页只取在线设备的实时会话。
import { ref, watch } from 'vue'
import {
  api,
  basename,
  logout,
  relTime,
  shortModel,
  stateClass,
  stateLabel,
  type Device,
  type SessionRow,
} from './api'
import { tmuxName } from '../config'
import NavTabs from './NavTabs.vue'

interface TaggedSession extends SessionRow {
  deviceId: string
  deviceName: string
  online: boolean
}
interface CwdGroup {
  cwd: string // 分组键(原文);空目录用空串,展示回退「无目录」
  sessions: TaggedSession[]
  devices: string[] // 贡献该卡片的不同设备名(去重)
  newest: number // 最新会话 mtime_ms,卡片间排序
}

const props = defineProps<{ owner: string; devs: Device[] | null }>()
const emit = defineEmits<{ reload: []; navigate: [path: string] }>()

const groups = ref<CwdGroup[] | null>(null)
const onlineCount = ref(0)
const expanded = ref<Set<string>>(new Set())

function toggleExpand(key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function load(): void {
  if (!props.devs) return
  groups.value = null
  const online = props.devs.filter((d) => d.online)
  onlineCount.value = online.length
  Promise.all(
    online.map((d) =>
      api('/x/' + d.id + '/sessions')
        .then((r) =>
          r.ok
            ? (r.json() as Promise<SessionRow[]>)
            : Promise.reject(new Error('HTTP ' + r.status)),
        )
        .then((rows) =>
          rows.map<TaggedSession>((s) => ({
            ...s,
            deviceId: d.id,
            deviceName: d.name,
            online: true,
          })),
        )
        .catch(() => [] as TaggedSession[]),
    ),
  ).then((perDevice) => {
    const all = perDevice.flat()
    const byCwd = new Map<string, TaggedSession[]>()
    for (const s of all) {
      const key = s.cwd || ''
      const arr = byCwd.get(key)
      if (arr) arr.push(s)
      else byCwd.set(key, [s])
    }
    const out: CwdGroup[] = []
    for (const [cwd, sessions] of byCwd) {
      sessions.sort((a, b) => (b.mtime_ms || 0) - (a.mtime_ms || 0))
      const devices = [...new Set(sessions.map((s) => s.deviceName))]
      out.push({ cwd, sessions, devices, newest: sessions[0]?.mtime_ms || 0 })
    }
    out.sort((a, b) => b.newest - a.newest)
    groups.value = out
  })
}

function refresh(): void {
  emit('reload') // 顺手刷新设备在线态
  load()
}

watch(() => props.devs, load, { immediate: true })
</script>

<template>
  <div class="wrap">
    <header class="top">
      <span class="brand">✈️ ccfly</span>
      <NavTabs active="allSessions" @navigate="emit('navigate', $event)" />
      <span class="who">{{ owner }}</span>
      <button class="ghost" title="刷新" @click="refresh">↻</button>
      <button class="ghost" @click="logout">退出</button>
    </header>
    <main>
      <p v-if="props.devs === null || groups === null" class="muted">加载会话…</p>
      <p v-else-if="onlineCount === 0" class="muted">没有在线设备。</p>
      <p v-else-if="groups.length === 0" class="muted">无会话(在线设备未在跑 Claude?)。</p>
      <div v-else class="cards">
        <section v-for="g in groups" :key="g.cwd || 'nocwd'" class="cwdcard">
          <div
            class="cwdhead pick"
            @click="
              g.sessions[0] &&
              emit('navigate', '/d/' + g.sessions[0].deviceId + '/' + g.sessions[0].session_id)
            "
          >
            <div class="cwdhead-top">
              <b class="cwdbase">{{ g.cwd ? basename(g.cwd) : '无目录 (no cwd)' }}</b>
              <button
                v-if="g.sessions.length > 1"
                class="cwdexp"
                :title="expanded.has(g.cwd || 'nocwd') ? '收起' : '展开全部会话'"
                @click.stop="toggleExpand(g.cwd || 'nocwd')"
              >
                {{ expanded.has(g.cwd || 'nocwd') ? '▾' : '▸' }}
              </button>
            </div>
            <span v-if="g.cwd" class="cwdpath">{{ g.cwd }}</span>
            <div v-if="g.sessions[0]" class="cwdlatest">
              <span class="st" :class="stateClass(g.sessions[0].state)">{{
                stateLabel(g.sessions[0].state)
              }}</span>
              <span v-if="g.sessions[0].live" class="live-dot" title="tmux 在跑" />
              <!-- live 会话直接显示其 tmux 会话名(服务端解析的真名;老设备没有该字段则按约定推导) -->
              <span v-if="g.sessions[0].live" class="tname">{{
                g.sessions[0].tmux || tmuxName(g.sessions[0].session_id)
              }}</span>
              <b class="cwdlatest-title">{{
                g.sessions[0].title || g.sessions[0].session_id.slice(0, 8)
              }}</b>
              <span class="rel">{{ relTime(g.sessions[0].mtime_ms) }}</span>
            </div>
            <div class="cwdmeta">
              <span class="muted">{{ g.sessions.length }} 个会话</span>
              <span v-for="dn in g.devices" :key="dn" class="chip">{{ dn }}</span>
            </div>
          </div>
          <ul v-if="expanded.has(g.cwd || 'nocwd')" class="list">
            <li
              v-for="s in g.sessions"
              :key="s.deviceId + '/' + s.session_id"
              class="item pick"
              @click="emit('navigate', '/d/' + s.deviceId + '/' + s.session_id)"
            >
              <span class="chip">{{ s.deviceName }}</span>
              <span class="st" :class="stateClass(s.state)">{{ stateLabel(s.state) }}</span>
              <span v-if="s.live" class="live-dot" title="tmux 在跑" />
              <span v-if="s.live" class="tname">{{ s.tmux || tmuxName(s.session_id) }}</span>
              <span class="grow">
                <b>{{ s.title || s.session_id.slice(0, 8) }}</b>
                <span class="pm">{{
                  [s.turns ? s.turns + '轮' : '', shortModel(s.model)].filter(Boolean).join(' · ')
                }}</span>
              </span>
              <span class="rel">{{ relTime(s.mtime_ms) }}</span>
            </li>
          </ul>
        </section>
      </div>
    </main>
  </div>
</template>
