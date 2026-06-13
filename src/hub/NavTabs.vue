<script setup lang="ts">
// NavTabs — 「会话」(/,首页) 与「设备」(/devices,管理页) 两个一级页面间切换。
defineProps<{ active: 'devices' | 'allSessions' }>()
const emit = defineEmits<{ navigate: [path: string] }>()
</script>

<template>
  <nav class="tabs">
    <button class="tab" :class="{ on: active === 'allSessions' }" @click="emit('navigate', '/')">
      会话
    </button>
    <button class="tab" :class="{ on: active === 'devices' }" @click="emit('navigate', '/devices')">
      设备
    </button>
  </nav>
</template>
