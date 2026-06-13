<script setup lang="ts">
// App — 模式路由:启动时探测 GET /api/me 区分「节点」与「cc.hn(Hub)」。
//   401            → Hub 未登录 → Login(/api/providers);若深链 /link/<id> 先暂存再跳登录。
//   200+JSON+owner → Hub 已登录 → HubShell(设备/会话/工作区)。
//   200 HTML / 网络错 → 节点模式(节点 ccfly 的 SPA 回退会把 /api/me 也回成 index.html)。
// 一份构建产物,两个 Go 二进制(ccfly 节点 / ccfly-cloud Hub)都 go:embed 它,运行时自适应。
import { ref, onMounted } from 'vue'
import { configure } from './config'
import { api, PENDING_LINK_KEY } from './hub/api'
import Workspace from './Workspace.vue'
import HubShell from './hub/HubShell.vue'
import Login from './hub/Login.vue'

type Mode = 'loading' | 'node' | 'hub'
const mode = ref<Mode>('loading')
const authed = ref(false)
const owner = ref('')
const providers = ref<string[]>([])
// node 模式可选 ?sid= 钉定会话(调试用);空则 Workspace 自动选最近活跃。
const nodeSid = new URLSearchParams(location.search).get('sid') || undefined

function toNode(): void {
  configure({ base: '' })
  mode.value = 'node'
}

onMounted(async () => {
  try {
    const res = await api('/api/me')
    if (res.status === 401) {
      mode.value = 'hub'
      authed.value = false
      // 未登录访问 /link/<id>:暂存目标 → 跳 GitHub 登录,回来后 HubShell 自动回跳。
      if (location.pathname.startsWith('/link/')) {
        localStorage.setItem(PENDING_LINK_KEY, location.pathname)
        location.href = '/auth/github/login'
        return
      }
      providers.value = await api('/api/providers')
        .then((r) => r.json())
        .catch(() => [])
      return
    }
    const ct = res.headers.get('content-type') || ''
    if (res.ok && ct.includes('application/json')) {
      const j = await res.json()
      if (j && j.owner !== undefined) {
        owner.value = j.owner
        authed.value = true
        mode.value = 'hub'
        return
      }
    }
    toNode() // 200 HTML(节点 SPA 回退)或其它形状
  } catch {
    toNode() // 网络错:按节点处理(同源端点仍可能可用)
  }
})
</script>

<template>
  <div v-if="mode === 'loading'" class="hub">
    <div class="center"><p class="muted">加载中…</p></div>
  </div>
  <!-- node 模式默认自动选「最近活跃」会话;?sid=<id> 可钉到指定会话(调试用,避开误选正在用的会话)。 -->
  <Workspace v-else-if="mode === 'node'" :initial-sid="nodeSid" />
  <HubShell v-else-if="authed" :owner="owner" />
  <div v-else class="hub"><Login :providers="providers" /></div>
</template>
