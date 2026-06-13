<script setup lang="ts">
// HubShell — 已登录的 cc.hn 主壳:History 路由在 跨设备会话(首页)/ 设备管理 / 单设备工作区 /
// 配对确认之间切换,并持有设备列表。移植自 App.tsx 的根逻辑(登录门由上层 App.vue 处理)。
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from './useRoute'
import { api, PENDING_LINK_KEY, type Device } from './api'
import DevicePicker from './DevicePicker.vue'
import AllSessions from './AllSessions.vue'
import DeviceView from './DeviceView.vue'
import LinkPage from './LinkPage.vue'

defineProps<{ owner: string }>()
const { route, navigate } = useRoute()
const devs = ref<Device[] | null>(null)

function loadDevs(): void {
  api('/api/devices')
    .then((r) => r.json())
    .then((d: Device[]) => (devs.value = d))
    .catch(() => (devs.value = []))
}
loadDevs()

// 登录后回跳到配对确认页:LinkGate(App.vue)未登录时存了 pending,这里在落到根路径时回跳。
onMounted(() => {
  const pending = localStorage.getItem(PENDING_LINK_KEY)
  if (pending) {
    localStorage.removeItem(PENDING_LINK_KEY)
    if (location.pathname === '/' && pending.startsWith('/link/')) navigate(pending)
  }
})

const deviceId = computed(() =>
  route.value.name === 'sessions' || route.value.name === 'session' ? route.value.device : null,
)
const dev = computed(() =>
  deviceId.value && devs.value ? (devs.value.find((d) => d.id === deviceId.value) ?? null) : null,
)
// 深链到不属于本账号(或已删)的设备 → 弹回设备列表。
watch([deviceId, devs], () => {
  if (deviceId.value && devs.value && !devs.value.some((d) => d.id === deviceId.value))
    navigate('/')
})
const initialSid = computed(() =>
  route.value.name === 'session' ? route.value.session : undefined,
)
</script>

<template>
  <!-- 单设备:DeviceView 直接挂 Workspace(不套 .hub) -->
  <template v-if="route.name === 'sessions' || route.name === 'session'">
    <div v-if="!dev" class="hub">
      <div class="center"><p class="muted">加载中…</p></div>
    </div>
    <DeviceView
      v-else
      :key="dev.id"
      :dev="dev"
      :initial-sid="initialSid"
      @navigate="navigate"
      @back="navigate('/')"
    />
  </template>

  <!-- 其余 shell 页:套 .hub 作用域(首页 = 会话卡片;设备管理在 /devices) -->
  <div v-else class="hub">
    <LinkPage v-if="route.name === 'link'" :pair-id="route.pairId" @navigate="navigate" />
    <DevicePicker
      v-else-if="route.name === 'devices'"
      :owner="owner"
      :devs="devs"
      @reload="loadDevs"
      @navigate="navigate"
    />
    <AllSessions v-else :owner="owner" :devs="devs" @reload="loadDevs" @navigate="navigate" />
  </div>
</template>
