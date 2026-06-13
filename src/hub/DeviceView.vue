<script setup lang="ts">
// DeviceView — 单设备视图:把契约 base 指向该设备的网关前缀 /x/<id>,再挂 Workspace。
// HubShell 以 key=设备id 挂本组件,故切设备会重挂 → configure 重跑,Workspace 重连。
// 不套 .hub 外壳:Workspace 用自己的全屏样式,且避免 .hub 的 button/input 规则渗进终端侧。
import { configure } from '../config'
import Workspace from '../Workspace.vue'
import type { Device } from './api'

const props = defineProps<{ dev: Device; initialSid?: string }>()
const emit = defineEmits<{ navigate: [path: string]; back: [] }>()

configure({ base: '/x/' + props.dev.id })
</script>

<template>
  <Workspace
    :initial-sid="props.initialSid"
    back
    :device-label="props.dev.name"
    @back="emit('back')"
    @navigate="emit('navigate', '/d/' + props.dev.id + '/' + $event)"
  />
</template>
