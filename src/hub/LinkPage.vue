<script setup lang="ts">
// LinkPage — 无码配对确认页(/link/<pairId>,需登录)。展示待绑定设备(主机名 · os/arch · 版本),
// 确认名字后 approve/deny。未登录的跳转暂存逻辑在 App.vue(LinkGate)。
import { ref, watch } from 'vue'
import { api, type PairInfo } from './api'

const props = defineProps<{ pairId: string }>()
const emit = defineEmits<{ navigate: [path: string] }>()

const info = ref<PairInfo | null>(null)
const err = ref<string | null>(null) // 致命错误(404/网络),与 info.status 区分
const name = ref('')
const busy = ref(false)
const done = ref<'approved' | 'denied' | null>(null)

watch(
  () => props.pairId,
  (id) => {
    info.value = null
    err.value = null
    api('/api/pair/' + encodeURIComponent(id))
      .then((r) => {
        if (r.status === 404) throw new Error('not_found')
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json() as Promise<PairInfo>
      })
      .then((d) => {
        info.value = d
        name.value = d.suggestedName || d.hostname || ''
      })
      .catch((e) => (err.value = e.message === 'not_found' ? 'not_found' : 'load'))
  },
  { immediate: true },
)

function approve(): void {
  busy.value = true
  api('/api/pair/' + encodeURIComponent(props.pairId) + '/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name.value.trim() }),
  })
    .then((r) => {
      if (r.status === 409) throw new Error('conflict') // 已批准/拒绝/过期
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then(() => (done.value = 'approved'))
    .catch((e) => {
      busy.value = false
      if (e.message === 'conflict' && info.value) info.value = { ...info.value, status: 'expired' }
      else err.value = 'approve'
    })
}

function deny(): void {
  busy.value = true
  api('/api/pair/' + encodeURIComponent(props.pairId) + '/deny', { method: 'POST' })
    .then(() => (done.value = 'denied'))
    .catch(() => (busy.value = false))
}

// pending 时的设备元信息行
const meta = (): string =>
  [
    info.value?.os && info.value?.arch
      ? info.value.os + '/' + info.value.arch
      : info.value?.os || info.value?.arch,
    info.value?.version ? 'v' + info.value.version : '',
  ]
    .filter(Boolean)
    .join(' · ')
</script>

<template>
  <!-- 各种终态:复用 .center/.card,底部统一「返回设备列表」 -->
  <div v-if="done === 'approved'" class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p class="sub">绑定新设备</p>
      <p style="font-size: 17px; margin: 10px 0">✅ 已绑定,回设备上即可,无需再操作</p>
      <button class="btn" @click="emit('navigate', '/')">返回设备列表</button>
    </div>
  </div>
  <div v-else-if="done === 'denied'" class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p class="muted">已拒绝该设备的绑定请求。</p>
      <button class="btn" @click="emit('navigate', '/')">返回设备列表</button>
    </div>
  </div>
  <div v-else-if="err === 'not_found'" class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p class="muted">链接无效或已失效。请回到设备上重新发起配对。</p>
      <button class="btn" @click="emit('navigate', '/')">返回设备列表</button>
    </div>
  </div>
  <div v-else-if="err" class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p class="muted">加载失败,请稍后重试。</p>
      <button class="btn" @click="emit('navigate', '/')">返回设备列表</button>
    </div>
  </div>
  <div v-else-if="!info" class="center"><p class="muted">加载中…</p></div>
  <div v-else-if="info.status === 'expired'" class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p class="muted">该配对请求已过期。请回到设备上重新运行 ccfly connect。</p>
      <button class="btn" @click="emit('navigate', '/')">返回设备列表</button>
    </div>
  </div>
  <div v-else-if="info.status === 'denied'" class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p class="muted">该配对请求已被拒绝。</p>
      <button class="btn" @click="emit('navigate', '/')">返回设备列表</button>
    </div>
  </div>
  <div v-else-if="info.status === 'approved'" class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p style="font-size: 17px; margin: 10px 0">✅ 该设备已绑定,无需再操作。</p>
      <button class="btn" @click="emit('navigate', '/')">返回设备列表</button>
    </div>
  </div>

  <!-- status === 'pending':待绑定设备 + 名称 + 批准/拒绝 -->
  <div v-else class="center">
    <div class="card link-card">
      <h1>✈️ ccfly</h1>
      <p class="sub">确认绑定这台设备到你的账号</p>
      <div class="newbox link-info">
        <b>{{ info.hostname || '未知主机' }}</b>
        <span v-if="meta()" class="muted link-meta">{{ meta() }}</span>
      </div>
      <input v-model="name" placeholder="设备名" autocomplete="off" :disabled="busy" />
      <button class="btn" :disabled="busy || !name.trim()" @click="approve">
        {{ busy ? '处理中…' : '批准并绑定' }}
      </button>
      <button class="btn ghost" :disabled="busy" @click="deny">拒绝</button>
    </div>
  </div>
</template>
