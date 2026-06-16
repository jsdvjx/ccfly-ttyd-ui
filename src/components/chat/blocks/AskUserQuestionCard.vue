<script setup lang="ts">
// AskUserQuestionCard — AskUserQuestion 工具:把「问题 + 选项 + 选中的答案」直接平铺展示(不折叠)。
// 数据来源:block.input.questions(问题与选项)+ tool_result 文本(形如
//   Your questions have been answered: "问题"="答案", ... )解析出每题答案,标出命中的选项;
// 没匹配到选项的自定义答案(Other)也照样把答案文字显示出来。
import { computed } from 'vue'
import ToolRow from './ToolRow.vue'
import { useToolStatus } from '../../../transcript/useToolStatus'
import type { Block } from '../../../transcript/types'

type Opt = { label?: string; description?: string }
type Q = { question?: string; header?: string; multiSelect?: boolean; options?: Opt[] }

const props = defineProps<{ block: Block; open?: boolean }>()
const { status, result } = useToolStatus(props.block)
const tone = computed(() =>
  status.value === 'err' ? 'err' : status.value === 'running' ? 'run' : 'ok',
)

const questions = computed<Q[]>(() => {
  const q = (props.block.input?.questions as Q[]) ?? []
  return Array.isArray(q) ? q : []
})

// 解析 result:抓所有 "问题"="答案" 对(答案可能含 ", " 分隔的多选)。
const answers = computed<Record<string, string>>(() => {
  const s = result.value?.content ?? ''
  const out: Record<string, string> = {}
  const re = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g
  for (let m = re.exec(s); m; m = re.exec(s)) out[m[1]] = m[2]
  return out
})

function answerFor(q: Q): string {
  return (q.question && answers.value[q.question]) || ''
}
function isChosen(q: Q, label?: string): boolean {
  const a = answerFor(q)
  if (!a || !label) return false
  return a === label || a.split(/,\s*/).includes(label)
}
</script>

<template>
  <ToolRow name="AskUserQuestion" desc="提问" :tone="tone" :foldable="false">
    <div v-if="questions.length" class="qs">
      <div v-for="(q, qi) in questions" :key="qi" class="q">
        <div class="qhd">
          <span v-if="q.header" class="chip">{{ q.header }}</span>
          <span class="qtx">{{ q.question }}</span>
        </div>
        <div class="opts">
          <div
            v-for="(o, oi) in q.options || []"
            :key="oi"
            class="opt"
            :class="{ on: isChosen(q, o.label) }"
          >
            <span class="mark">{{ isChosen(q, o.label) ? '●' : '○' }}</span>
            <div class="otx">
              <div class="olabel">{{ o.label }}</div>
              <div v-if="o.description" class="odesc">{{ o.description }}</div>
            </div>
          </div>
        </div>
        <div v-if="answerFor(q)" class="ans">
          <span class="anslb">答</span><span class="anstx">{{ answerFor(q) }}</span>
        </div>
        <div v-else class="ans pending">待回答…</div>
      </div>
    </div>
    <!-- input 没解析出 questions 时,兜底直接显示结果文本 -->
    <pre v-else-if="result?.content" class="raw">{{ result.content }}</pre>
  </ToolRow>
</template>

<style scoped>
.qs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.q {
  border: 1px solid var(--bd);
  border-radius: 8px;
  background: var(--bg2);
  padding: 8px 10px;
}
.qhd {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 7px;
}
.chip {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--mut);
  border: 1px solid var(--bd);
  border-radius: 4px;
  padding: 1px 6px;
}
.qtx {
  font-size: 13px;
  color: var(--fg);
  font-weight: 600;
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.opt {
  display: flex;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
}
.opt.on {
  background: rgba(63, 185, 80, 0.1); /* 命中项淡绿底 */
}
.mark {
  flex: none;
  font-size: 11px;
  color: #6e6e6e;
  padding-top: 2px;
}
.opt.on .mark {
  color: var(--green);
}
.otx {
  min-width: 0;
}
.olabel {
  font-size: 12.5px;
  color: var(--mut);
}
.opt.on .olabel {
  color: var(--fg);
  font-weight: 600;
}
.odesc {
  font-size: 11.5px;
  color: #7d7d7d;
  line-height: 1.5;
  margin-top: 1px;
}
.ans {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid var(--bd);
  font-size: 12.5px;
}
.anslb {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  color: var(--green);
  letter-spacing: 0.5px;
}
.anstx {
  color: var(--fg);
}
.ans.pending {
  color: var(--amber);
  font-size: 11.5px;
}
.raw {
  font-family: var(--vsc-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 6px 8px;
  background: #181818;
  border: 1px solid var(--bd);
  border-radius: 6px;
  color: var(--mut);
}
</style>
