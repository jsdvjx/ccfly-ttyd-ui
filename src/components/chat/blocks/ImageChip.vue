<script setup lang="ts">
import { computed } from 'vue'
import { imageUrl } from '../../../config'
import { useFullView } from '../fullview'
import type { Block } from '../../../transcript/types'
const props = defineProps<{ block: Block; sid: string; uuid?: string }>()
const openFull = useFullView()
const src = computed(() => {
  if (props.block.data)
    return `data:${props.block.mediaType || 'image/png'};base64,${props.block.data}`
  if (props.uuid && props.block.imgIdx != null)
    return imageUrl(props.sid, props.uuid, props.block.imgIdx)
  return ''
})
</script>

<template>
  <img
    v-if="src"
    class="img"
    :src="src"
    alt="image"
    title="点击放大"
    @click="openFull({ kind: 'image', src })"
  />
  <span v-else class="m">[图片]</span>
</template>

<style scoped>
.img {
  max-width: 360px;
  max-height: 300px;
  border: 1px solid var(--bd);
  border-radius: 6px;
  margin: 5px 0;
  display: block;
  cursor: zoom-in;
}
.m {
  color: var(--mut);
}
</style>
