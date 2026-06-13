<script setup lang="ts">
// ToolRow — 工具/可折叠条目的时间线行:状态点 +「名 描述」表头(可折叠)+ 可选展开体。
// 取代旧的 BlockShell 卡片外壳,改为参考里的扁平时间线:无包裹边框,仅代码块自身带框。
import { ref, computed } from 'vue'
import { iconSvg } from './icons'
const props = defineProps<{
  name: string
  desc?: string
  tone?: 'ok' | 'err' | 'run' | 'mut'
  mono?: boolean // desc 用等宽(文件名/路径/命令)
  dim?: boolean // 名也暗淡(thinking)
  foldable?: boolean
  defaultOpen?: boolean
}>()
const iconHtml = computed(() => iconSvg(props.name)) // 按工具名取一枚修饰图标(本地静态 SVG)
const o = ref(props.defaultOpen !== false)
const show = computed(() => !props.foldable || o.value)
function toggle() {
  if (props.foldable) o.value = !o.value
}
</script>

<template>
  <div class="trow">
    <span class="dot" :class="tone || 'ok'" />
    <div class="col">
      <component
        :is="foldable ? 'button' : 'div'"
        class="hd"
        :class="{ btn: foldable }"
        @click="toggle"
      >
        <span v-if="iconHtml" class="ic" :class="{ dim }" v-html="iconHtml" />
        <span class="nm" :class="{ dim }">{{ name }}</span>
        <span v-if="desc" class="ds" :class="{ mono }">{{ desc }}</span>
        <!-- 运行中(tone=run,即工具/脚本还没回结果):title 后挂「转圈 + 运行中」状态 -->
        <span v-if="tone === 'run'" class="run-st" title="运行中…">
          <span class="spin" />
          <span class="run-tx">运行中</span>
        </span>
        <span v-if="foldable" class="cv">{{ o ? '▾' : '▸' }}</span>
      </component>
      <div v-show="show" class="bd"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.trow {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 5px 0;
}
/* 竖线(rail)由 TurnGroup 统一画(首点→末点),这里只出点。 */
.col {
  flex: 1;
  min-width: 0;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 7px;
  flex: none;
  position: relative;
  z-index: 1; /* 压在 rail 之上 */
}
.dot.ok {
  background: var(--green);
}
.dot.err {
  background: var(--red);
}
.dot.run {
  background: var(--amber);
}
.dot.mut {
  background: #4a4a4a;
}
.hd {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  font-size: 13px;
  color: var(--fg);
}
.hd.btn {
  background: none;
  border: 0;
  text-align: left;
  cursor: pointer;
  padding: 0;
}
.ic {
  flex: none;
  align-self: center; /* hd 是 baseline 对齐,图标改为垂直居中,和文字行齐 */
  display: inline-flex;
  color: var(--mut); /* 低调修饰色,随 currentColor */
}
.ic.dim {
  opacity: 0.6;
}
.nm {
  font-weight: 600;
  flex: none;
}
.nm.dim {
  font-weight: 400;
  color: var(--mut);
}
/* 运行中状态:挂在 title 后(转圈 + 「运行中」文字);amber 与 run 状态点同色。 */
.run-st {
  flex: none;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 6px;
  color: var(--amber);
}
.spin {
  flex: none;
  width: 11px;
  height: 11px;
  border: 1.6px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: trow-spin 0.7s linear infinite;
}
.run-tx {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0.3px;
}
@keyframes trow-spin {
  to {
    transform: rotate(360deg);
  }
}
.ds {
  color: var(--mut);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.ds.mono {
  font-family: var(--vsc-mono);
  font-size: 12px;
}
.cv {
  color: var(--mut);
  flex: none;
  margin-left: auto;
  font-size: 10px;
  padding-left: 8px;
}
.bd {
  margin-top: 6px;
}
</style>
