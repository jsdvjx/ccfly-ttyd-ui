<script setup lang="ts">
// DiffView — 渲染 structuredPatch 的 hunk(带真实行号 + 红绿)。总行数超阈值才给「全屏」按钮;full 模式放开高度、不给按钮。
import { computed } from 'vue'
import type { PatchHunk } from '../../../transcript/types'
import { useFullView } from '../fullview'
const props = defineProps<{ hunks: PatchHunk[]; title?: string; full?: boolean }>()
const cls = (l: string) => (l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx')
const total = computed(() => props.hunks.reduce((a, h) => a + h.lines.length + 1, 0))
const FULL_LINES = 24
const canFull = computed(() => !props.full && total.value > FULL_LINES)
const openFull = useFullView()
</script>

<template>
  <div class="dw">
    <button
      v-if="canFull"
      class="fullbtn"
      title="全屏查看"
      @click="openFull({ kind: 'diff', hunks, title })"
    >
      ⤢ 全屏
    </button>
    <div class="diff" :class="{ full }">
      <template v-for="(h, hi) in hunks" :key="hi">
        <div class="hunk">
          @@ -{{ h.oldStart }},{{ h.oldLines }} +{{ h.newStart }},{{ h.newLines }} @@
        </div>
        <div v-for="(l, li) in h.lines" :key="li" class="row" :class="cls(l)">{{ l }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dw {
  position: relative;
}
.fullbtn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--bd);
  background: #2a2a2acc;
  color: var(--mut);
  cursor: pointer;
}
.fullbtn:hover {
  color: var(--fg);
  border-color: var(--acc);
}
.diff {
  font-family: var(--vsc-mono);
  font-size: 12.5px;
  line-height: 1.5;
  background: #181818;
  border: 1px solid var(--bd);
  border-radius: 6px;
  overflow: auto;
  max-height: 460px;
}
.diff.full {
  max-height: none;
}
.hunk {
  color: #6e7681;
  padding: 2px 10px;
  background: #1c1c1c;
  white-space: pre;
}
.row {
  white-space: pre;
  padding: 0 10px;
}
.row.add {
  background: var(--vsc-add-wash);
  color: #7ee787;
}
.row.del {
  background: var(--vsc-del-wash);
  color: #ffa198;
}
.row.ctx {
  color: var(--mut);
}
</style>
