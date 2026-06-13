<script setup lang="ts">
// Row — transcript 扁平时间线行:左侧状态点 + 右侧内容列。竖线(rail)由 TurnGroup 统一绘制(首点→末点,
// 不在每行各画一段,避免末点之后还拖一截),这里只出点。
defineProps<{ tone?: 'ok' | 'err' | 'run' | 'mut' | 'fg' }>()
</script>

<template>
  <div class="row">
    <span class="dot" :class="tone || 'fg'" />
    <div class="col"><slot /></div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 5px 0;
}
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
  background: #6a6a6a;
  position: relative;
  z-index: 1; /* 压在 TurnGroup 的 rail 之上,形成节点 */
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
.dot.fg {
  background: #6a6a6a;
}
</style>
