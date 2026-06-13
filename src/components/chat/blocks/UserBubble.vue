<script setup lang="ts">
// UserBubble — 用户真提问:参考里是顶部一个低调圆角框(含文本 + 可能的图片附件)。
import { computed } from 'vue'
import Md from './Md.vue'
import ImageChip from './ImageChip.vue'
import type { Item } from '../../../transcript/types'
const props = defineProps<{ item: Item; sid: string }>()
const images = computed(() => (props.item.blocks ?? []).filter((b) => b.type === 'image'))
</script>

<template>
  <div class="ub">
    <Md v-if="item.text" :text="item.text" />
    <ImageChip v-for="(b, i) in images" :key="i" :block="b" :sid="sid" :uuid="item.uuid" />
  </div>
</template>

<style scoped>
.ub {
  background: #2a2a2a;
  border: 1px solid #383838;
  border-radius: 10px;
  padding: 10px 14px;
  margin: 22px 0 6px;
}
</style>
