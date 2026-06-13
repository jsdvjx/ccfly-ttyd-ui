<script setup lang="ts">
// DevicePicker — 设备管理页(/devices):创建(给出 connect 码)/ 改名 / 删除(行内二次确认),
// 并展示每台设备的概况:os/arch · 版本 · overlay IP · 在线态,以及在线设备的会话统计
// (会话总数 / 涉及目录数 / 最近活跃)。进会话走首页的会话卡片,本页不再提供「打开」入口。
import { ref, watch } from 'vue'
import { api, logout, relTime, type Device, type SessionRow } from './api'
import NavTabs from './NavTabs.vue'

const props = defineProps<{ owner: string; devs: Device[] | null }>()
const emit = defineEmits<{ reload: []; navigate: [path: string] }>()

const name = ref('')
const created = ref<Device | null>(null)
// 删除二次确认:点「删除」先把该设备 id 暂存、行内变出「确认/取消」;真删才发请求。
const confirmDel = ref<string | null>(null)
const delErr = ref('')

// ── 会话统计(仅在线设备)──
// 云端的会话缓存表当前无人写入,离线设备拿不到任何会话数据;故统计只对在线设备实时
// GET /x/<id>/sessions(与会话首页同一网关),离线设备退化为展示「最近在线」。
interface DevStats {
  sessions: number
  dirs: number // 涉及的不同目录数(cwd 去重;无 cwd 的会话合并算一类)
  newest: number // 最新会话 mtime_ms(最近活跃)
}
const stats = ref<Record<string, DevStats | 'loading' | 'error'>>({})

function loadStats(devs: Device[]): void {
  for (const d of devs) {
    if (!d.online) continue
    stats.value = { ...stats.value, [d.id]: 'loading' }
    api('/x/' + d.id + '/sessions')
      .then((r) =>
        r.ok ? (r.json() as Promise<SessionRow[]>) : Promise.reject(new Error('HTTP ' + r.status)),
      )
      .then((rows) => {
        const dirs = new Set(rows.map((s) => s.cwd || ''))
        const newest = rows.reduce((m, s) => Math.max(m, s.mtime_ms || 0), 0)
        stats.value = {
          ...stats.value,
          [d.id]: { sessions: rows.length, dirs: dirs.size, newest },
        }
      })
      .catch(() => (stats.value = { ...stats.value, [d.id]: 'error' }))
  }
}
watch(
  () => props.devs,
  (devs) => devs && loadStats(devs),
  { immediate: true },
)

function create(): void {
  api('/api/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name.value.trim() || 'device' }),
  })
    .then((r) => r.json())
    .then((d: Device) => {
      name.value = ''
      created.value = d
      emit('reload')
    })
    .catch(() => {})
}

// ── 改名(行内编辑)──
const renId = ref<string | null>(null)
const renName = ref('')
const renBusy = ref(false)
const renErr = ref('')

function askRen(d: Device): void {
  renId.value = d.id
  renName.value = d.name
  renErr.value = ''
}
function cancelRen(): void {
  renId.value = null
  renErr.value = ''
}
function saveRen(id: string): void {
  const n = renName.value.trim()
  if (!n || renBusy.value) return
  renBusy.value = true
  api('/api/devices/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: n }),
  })
    .then(async (r) => {
      renBusy.value = false
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        renErr.value = '改名失败 (' + r.status + ')' + (t ? ': ' + t : '')
        return
      }
      renId.value = null
      emit('reload')
    })
    .catch(() => {
      renBusy.value = false
      renErr.value = '改名失败:网络错误'
    })
}

// 真正执行删除:失败把原因冒出来(过去静默,失败也无提示 → 看着像「删不掉」)。
function doDel(id: string): void {
  delErr.value = ''
  api('/api/devices/' + id, { method: 'DELETE' })
    .then(async (r) => {
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        delErr.value = '删除失败 (' + r.status + ')' + (t ? ': ' + t : '')
        return
      }
      confirmDel.value = null
      emit('reload')
    })
    .catch(() => (delErr.value = '删除失败:网络错误'))
}

// 行内确认开关(模板内联多语句在生产编译器下会解析失败,抽成方法)。
function askDel(id: string): void {
  confirmDel.value = id
  delErr.value = ''
}
function cancelDel(): void {
  confirmDel.value = null
  delErr.value = ''
}

// 模板取数收口:loading/error 之外才是真统计(模板里写 as 断言,生产编译器不认)。
function statsOf(id: string): DevStats | null {
  const s = stats.value[id]
  return s && s !== 'loading' && s !== 'error' ? s : null
}

// os/arch · 版本 · overlay IP 拼一行(缺啥省啥)。
function metaLine(d: Device): string {
  return [
    d.os && d.arch ? d.os + '/' + d.arch : d.os || d.arch || '',
    d.version ? 'v' + d.version : '版本未知',
    d.overlay_ip || '',
  ]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <div class="wrap">
    <header class="top">
      <span class="brand">✈️ ccfly</span>
      <NavTabs active="devices" @navigate="emit('navigate', $event)" />
      <span class="who">{{ owner }}</span>
      <button class="ghost" @click="logout">退出</button>
    </header>
    <main>
      <div class="row">
        <input v-model="name" placeholder="设备名,如 my-laptop" autocomplete="off" />
        <button @click="create">+ 创建设备</button>
      </div>
      <div v-if="created?.connect" class="newbox">
        新设备 <b>{{ created.name }}</b> 已创建。在该机器运行:
        <div class="cmd">
          <code>{{ created.connect }}</code>
        </div>
      </div>
      <p v-if="delErr" class="muted err">{{ delErr }}</p>

      <p v-if="props.devs === null" class="muted">加载中…</p>
      <p v-else-if="props.devs.length === 0" class="muted">
        还没有设备。创建一个,在目标机器运行它给出的 ccfly connect 命令。
      </p>
      <div v-else class="cards">
        <section v-for="d in props.devs" :key="d.id" class="devcard">
          <!-- 首行:状态点 + 名称(或改名编辑)+ 操作 -->
          <div class="devhead">
            <span class="dot" :class="d.online ? 'on' : 'off'" />
            <template v-if="renId === d.id">
              <input
                v-model="renName"
                class="ren-input"
                autocomplete="off"
                :disabled="renBusy"
                @keyup.enter="saveRen(d.id)"
                @keyup.esc="cancelRen"
              />
              <button :disabled="renBusy || !renName.trim()" @click="saveRen(d.id)">保存</button>
              <button class="ghost" :disabled="renBusy" @click="cancelRen">取消</button>
            </template>
            <template v-else>
              <b class="grow">{{ d.name }}</b>
              <button class="ghost" @click="askRen(d)">改名</button>
              <template v-if="confirmDel === d.id">
                <button class="ghost danger" @click="doDel(d.id)">确认删除</button>
                <button class="ghost" @click="cancelDel">取消</button>
              </template>
              <button v-else class="ghost" @click="askDel(d.id)">删除</button>
            </template>
          </div>
          <p v-if="renId === d.id && renErr" class="muted err">{{ renErr }}</p>

          <!-- 元信息行:os/arch · 版本 · overlay IP -->
          <div class="devmeta">{{ metaLine(d) }}</div>

          <!-- 状态/统计行 -->
          <div class="devstats">
            <template v-if="!d.enrolled_at">
              <span class="chip">未接入</span>
              <span v-if="d.connect_code" class="muted">配对码 {{ d.connect_code }}</span>
            </template>
            <template v-else-if="!d.online">
              <span class="chip">离线</span>
              <span class="muted">{{
                d.last_seen ? '最近在线 ' + relTime(d.last_seen * 1000) : '最近在线时间未知'
              }}</span>
            </template>
            <template v-else>
              <span class="chip on">在线</span>
              <span v-if="stats[d.id] === 'error'" class="muted">会话统计不可用</span>
              <span v-else-if="!statsOf(d.id)" class="muted">统计中…</span>
              <span v-else class="muted">
                {{ statsOf(d.id)!.sessions }} 个会话 · {{ statsOf(d.id)!.dirs }} 个目录{{
                  statsOf(d.id)!.newest ? ' · 最近活跃 ' + relTime(statsOf(d.id)!.newest) : ''
                }}
              </span>
            </template>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
