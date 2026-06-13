<script setup lang="ts">
// AssistantText — 助手正文:时间线行(fg 点)+ markdown。
import Row from './Row.vue'
import Md from './Md.vue'
defineProps<{ text?: string }>()
</script>

<template>
  <Row tone="fg"><Md :text="text" /></Row>
</template>
