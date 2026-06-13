<script setup lang="ts">
// ReadCard — Read:
//   文本文件:展开看内容(cat -n 去行号 + 去尾部 system-reminder),代码高亮。
//   图片文件(读 bash 产出的截图那种):结果是图片块,默认折叠;展开直接显示这张图,不再「读取中…」。
//   「读取中…」只在 status===running(结果还没回)时显示,而非「有结果但无文本」。
import { computed } from 'vue'
import ToolRow from './ToolRow.vue'
import CodeView from './CodeView.vue'
import { useToolStatus } from '../../../transcript/useToolStatus'
import { langFromPath } from '../../../highlight'
import { useFullView } from '../fullview'
import type { Block } from '../../../transcript/types'
const props = defineProps<{ block: Block; open?: boolean }>()
const openFull = useFullView()
const { status, result } = useToolStatus(props.block)
const path = computed(() => (props.block.input?.file_path as string) ?? '')
const base = computed(() => path.value.split('/').pop() || path.value)
const lang = computed(() => langFromPath(path.value))
const isImage = computed(() => /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(path.value))
const imgSrc = computed(() =>
  result.value?.data
    ? `data:${result.value.mediaType || 'image/png'};base64,${result.value.data}`
    : '',
)
const tone = computed(() =>
  status.value === 'err' ? 'err' : status.value === 'running' ? 'run' : 'ok',
)
const code = computed(() =>
  (result.value?.content ?? '')
    .replace(/\n<system-reminder>[\s\S]*$/, '')
    .replace(/^\s*\d+\t/gm, ''),
)
// 图片类默认折叠(很多、且无文本);文本类默认展开。在展开的多工具组里(open=true)则一律展开(含图片出图)。
const openDefault = computed(() => props.open ?? !isImage.value)
</script>

<template>
  <ToolRow name="Read" :desc="base" mono :tone="tone" foldable :default-open="openDefault">
    <img
      v-if="imgSrc"
      class="rimg"
      :src="imgSrc"
      alt="read image"
      title="点击放大"
      @click="openFull({ kind: 'image', src: imgSrc, title: base })"
    />
    <CodeView v-else-if="code" :code="code" :lang="lang" :title="path" />
    <span v-else-if="status === 'running'" class="m">读取中…</span>
    <span v-else class="m">{{ isImage ? '(图片,已读取)' : '(无文本输出)' }}</span>
  </ToolRow>
</template>

<style scoped>
.m {
  color: var(--mut);
  font-size: 12px;
}
.rimg {
  max-width: 100%;
  max-height: 360px;
  border: 1px solid var(--bd);
  border-radius: 6px;
  display: block;
  cursor: zoom-in;
}
</style>
