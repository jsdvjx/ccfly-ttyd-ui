<script setup lang="ts">
// Notice — system/伪用户「通知行」的分发器:把 local-command 行升格为富渲染,其余落回 SystemNotice。
//   /context 输出(<local-command-stdout> 含 "Context Usage")→ ContextCard 条形图卡;
//   命令调用块(<command-name>…)→ 一行「❯ /cmd args」斜杠 chip;
//   其余 stdout → 剥标签剥 ANSI 后的暗淡输出行(空输出 / caveat 行 → 整条隐藏,**不再铺原文**);
//   其它(api_error 文案、reminder、interrupted…)→ 原暗淡 SystemNotice。
// local-command 既可能以 system/local_command 落盘,也可能以 user 事件落盘(看 item.text 标签)。
// 加一种富通知 = 这里加一个分支,不改 TurnGroup。
import { computed } from 'vue'
import type { Item } from '../../../transcript/types'
import {
  parseContextUsage,
  parseSlashInvoke,
  isLocalCommandText,
  localStdoutPlain,
} from '../../../transcript/parseContext'
import ContextCard from './ContextCard.vue'
import SystemNotice from './SystemNotice.vue'

const props = defineProps<{ item: Item }>()

// /context 的伴生 markdown(独立 system 消息「## Context Usage…」,内容与 ContextCard 全量重复)
// → 整条隐藏,不铺原文。
const ctxDup = computed(() => /^\s*##\s*Context Usage\b/i.test(props.item.text || ''))

const isLocalCmd = computed(
  () => props.item.kind === 'local_command' || isLocalCommandText(props.item.text || ''),
)
const ctx = computed(() => (isLocalCmd.value ? parseContextUsage(props.item.text || '') : null))
const invoke = computed(() =>
  isLocalCmd.value && !ctx.value ? parseSlashInvoke(props.item.text || '') : null,
)
// 卡片/chip 之外的 local-command:stdout 纯文本(''=隐藏整条);非 local-command → null → SystemNotice。
const plain = computed(() =>
  isLocalCmd.value && !ctx.value && !invoke.value ? localStdoutPlain(props.item.text || '') : null,
)
</script>

<template>
  <!-- /context 伴生 markdown:与卡片重复 → 隐藏 -->
  <template v-if="ctxDup" />
  <ContextCard v-else-if="ctx" :ctx="ctx" />
  <div v-else-if="invoke" class="slash">
    <span class="caret">❯</span>
    <span class="name">{{ invoke.name }}</span>
    <span v-if="invoke.args" class="args">{{ invoke.args }}</span>
  </div>
  <div v-else-if="plain" class="stdout">⎿ {{ plain }}</div>
  <!-- plain === ''(caveat / 空输出)→ 不渲染任何分支,整条隐藏 -->
  <SystemNotice v-else-if="plain === null" :item="item" />
</template>

<style scoped>
.slash {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin: 8px 0 2px;
  font-family: var(--vsc-mono);
  font-size: 12px;
}
.caret {
  color: var(--acc);
}
.name {
  color: var(--fg);
  font-weight: 600;
}
.args {
  color: var(--mut);
}
.stdout {
  color: var(--mut);
  font-family: var(--vsc-mono);
  font-size: 12px;
  margin: 2px 0 2px 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
