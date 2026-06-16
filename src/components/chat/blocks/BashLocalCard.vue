<script setup lang="ts">
// BashLocalCard — 用户在 Claude Code 里敲 `!命令`(bash 模式)的回显卡:IN(命令)/ OUT(stdout)/
// ERR(stderr)。区别于 BashCard(那是 assistant 的 Bash 工具调用):这里是用户主动跑的 shell,
// 没有工具状态,输入/输出来自相邻的两条 user 事件(由 flattenTurn 合并进同一张卡)。
import { computed } from 'vue'
import { hl } from '../../../highlight'
import type { Block } from '../../../transcript/types'

const props = defineProps<{ blocks: Block[] }>()
const input = computed(() => props.blocks.find((b) => b.type === 'bash-input')?.text ?? '')
const stdoutBlock = computed(() => props.blocks.find((b) => b.type === 'bash-stdout'))
const stderr = computed(() => props.blocks.find((b) => b.type === 'bash-stderr')?.text ?? '')
const cmdHtml = computed(() => hl(input.value, 'bash'))
</script>

<template>
  <div class="bashloc">
    <div class="hd"><span class="bang">!</span> bash</div>
    <div class="iobox">
      <div v-if="input" class="ioln">
        <span class="iolb">IN</span>
        <pre class="iotx cmd hljs" v-html="cmdHtml" />
      </div>
      <div v-if="stdoutBlock" class="ioln">
        <span class="iolb">OUT</span>
        <pre class="iotx out">{{ stdoutBlock.text || '(无输出)' }}</pre>
      </div>
      <div v-if="stderr" class="ioln">
        <span class="iolb">ERR</span>
        <pre class="iotx out err">{{ stderr }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bashloc {
  margin: 2px 0;
}
.hd {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: #6e6e6e;
  margin: 0 0 4px 2px;
}
.bang {
  color: var(--amber);
  font-weight: 700;
}
.iobox {
  border: 1px solid var(--bd);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg2);
}
.ioln {
  display: flex;
  gap: 10px;
  padding: 7px 10px;
}
.ioln + .ioln {
  border-top: 1px solid var(--bd);
}
.iolb {
  width: 30px;
  flex: none;
  color: #6e6e6e;
  font-size: 10px;
  font-weight: 600;
  padding-top: 2px;
  letter-spacing: 0.5px;
}
.iotx {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-family: var(--vsc-mono);
  font-size: 12px;
  line-height: 1.5;
}
.iotx.cmd {
  color: #d4d4d4;
  white-space: pre;
  overflow-x: auto;
}
.iotx.out {
  color: var(--mut);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
.iotx.out.err {
  color: #ff9b94;
}
</style>
