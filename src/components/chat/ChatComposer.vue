<script setup lang="ts">
// ChatComposer — VSCode-CC 风格输入框:自增高 textarea + 工具栏 + 状态驱动的 发送/停止。
// 纯文本发送走确认式管线(useSend / /term WS);带图发送走 HTTP /sendkeys 原子提交
// (clear+text+images+enter):图片先经 /upload 落盘会话 cwd 的 .ccfly-uploads/,设备端再
// tmux 括号粘贴其路径 → 里世界原生 [Image #N](见 useAttachments / config.sendkeysUrl 注释)。
// 停止:确认式进行中→打断,claude 生成中→发 Esc。
// 注:斜杠命令只走原生路径(用户自己在输入框打 /xxx 发送);UI 不代打任何命令。
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSend } from '../../composables/useSend'
import ConfirmDialog from './ConfirmDialog.vue'
import { useAttachments } from '../../composables/useAttachments'
import { tmuxName, sendkeysUrl } from '../../config'
import { fmtDur, fmtPermMode, fmtStatus } from '../../fmt'
import { detectUsage, type SessionState, type JEvent } from '../../state'
const props = defineProps<{
  sid: string // 原始 claude session id(/upload·/sendkeys 的 session 参数用 tmuxName(sid))
  send: (s: string) => void
  ensureLive: () => Promise<void>
  readInput: () => string
  getEvents: () => JEvent[]
  getScreen: () => string[]
  state: SessionState
  connected: boolean
  jsonlConnected: boolean
  termless: boolean // 会话没有可控 tmux pane(节点 fail-closed 断言)→ 只读,终端永远连不上
  reconnectAll: () => void
  takeover: () => Promise<void> // 接管:杀掉既有 claude 进程 → /term 重建进 tmux(防双写)
}>()
const { phase, error, busy, sendText, interrupt, raw } = useSend({
  send: props.send,
  readInput: props.readInput,
  getEvents: props.getEvents,
  verifyScreen: false, // chat 隐藏终端读不到屏 → 盲发,靠 jsonl 确认提交
})
const text = ref('')
const ta = ref<HTMLTextAreaElement | null>(null)
const st = computed(() => props.state.status)

// ── 附图:选文件 / 粘贴 / 拖拽 → 立即 /upload;提交时把路径交给 /sendkeys images。──
const atts = useAttachments(() => tmuxName(props.sid))
const fileEl = ref<HTMLInputElement | null>(null)
const apiBusy = ref(false) // 带图提交(HTTP /sendkeys)在途
const apiErr = ref('')
function pickFiles(): void {
  fileEl.value?.click()
}
function onFiles(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.files?.length) atts.addFiles(input.files)
  input.value = '' // 复位:同一文件可再次选择
}
function onPaste(e: ClipboardEvent): void {
  const files: File[] = []
  for (const it of e.clipboardData?.items ?? []) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) {
    e.preventDefault() // 只拦图片粘贴;纯文本粘贴不受影响
    atts.addFiles(files)
  }
}
function onDrop(e: DragEvent): void {
  if (e.dataTransfer?.files?.length) atts.addFiles(e.dataTransfer.files)
}

// ── 模型选择入口:经设备 /sendkeys 原生打开 /model 菜单 ──
// /sendkeys 用 tmux send-keys -l 逐字面打字(等同真人在终端敲 "/model",原生触发命令面板),
// Enter 是独立按键 → 面板高亮的精确匹配项被执行,弹出「Select model」菜单;屏检测随即翻
// select,上面的 select 映射视图接管选择(↑/↓ + Enter)。与 WS 括号粘贴不同,不存在
// 「命令被当作粘贴文本/聊天消息」的歧义;且自带 server floor(非输入态 409 拒发)。
//
// 关键(本次 bug 根因 + 修复,CDP 实测确认):隐藏终端的 /term WS 在 hub 链路
// (浏览器→Caddy→cc.hn 网关→WG overlay→设备)上会「半开假活」——socket readyState 仍 OPEN、
// connected 仍 true,但设备→客户端方向已静默断流,xterm 画面冻结在旧帧。于是菜单虽在设备真实
// 终端里弹出,隐藏 xterm 却收不到这次重绘 → detectSelect 读到的是旧 idle 屏 → select 视图不渲染。
// 普通聊天无感(发送是盲发 + jsonl 确认、不依赖读屏;状态在屏判落空时退回 jsonl),唯独 select/
// usage 这类「纯靠读屏」的态会失效——与现象完全吻合。浏览器 WS 不暴露 ping/pong,无法在 JS 侧探测
// 半开;但**强制重连一次** /term 即 new-session -A 重新 attach → tmux 推全量重绘 → 冻屏复活、
// 菜单进入读屏 → select 渲染(CDP 实测:全新连接 500ms 内出 select)。故打开菜单后强制重连终端。
const modelBusy = ref(false)
async function openModelMenu(): Promise<void> {
  if (!canSend.value || modelBusy.value || apiBusy.value) return
  modelBusy.value = true
  apiErr.value = ''
  try {
    const r = await fetch(sendkeysUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        session: tmuxName(props.sid),
        text: '/model',
        clear: true,
        enter: true,
      }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kind?: string }
    if (r.ok && j.ok) {
      // 菜单已在设备端弹出;强制重连隐藏终端,让(可能半开冻结的)/term 重新 attach 取全量重绘,
      // select 屏才进得了读屏环路。延一拍确保菜单已渲染好,重连后的全量重绘即含菜单。
      setTimeout(() => props.reconnectAll(), 500)
    } else {
      apiErr.value =
        j.kind === 'stale'
          ? '会话已被取代,请回列表重进'
          : r.status === 409
            ? '当前不是输入态,稍后再试'
            : '打开模型菜单失败 (' + r.status + ')'
    }
  } catch {
    apiErr.value = '打开模型菜单失败:网络错误'
  } finally {
    modelBusy.value = false
  }
}

// ── /compact:压缩对话(总结历史、释放上下文)──
// 与 /model 同走原生 /sendkeys(literal 打字 + Enter);它不弹菜单,而是直接进「Compacting…」忙态
// 再回 idle(现有 busy 检测会展示进度)。可选「聚焦指令」拼成 `/compact <instr>`(实测 send-keys
// 字面 + Enter 不会被命令补全面板劫持)。
const compactOpen = ref(false)
const compactInstr = ref('')
const compacting = ref(false) // /sendkeys 在途(发命令的瞬间)
const compactErr = ref('')
// 压缩进度态:'idle' 无 →(命令已发)'running' 里世界 Compacting,进度条按**真·百分比**填充 → 'done' 补满转绿闪一下 → 回 idle。
// 关键:原生 /compact 确实在屏上画「Compacting conversation… NN%」的真进度条(与自由式 LLM 总结不同,
// 压缩有可度量的进度)。所以进度条吃的是**读屏得到的那个真值**(state.compactPct),不是编的耗时曲线。
// 还没读到真值的头一两帧(命令刚发、屏未刷)才退回不定式扫光过渡;一旦读到就跳到真百分比。
const compactPhase = ref<'idle' | 'running' | 'done'>('idle')
const compactStartMs = ref(0)
const sawRealPct = ref(false) // 本轮是否读到过真·百分比(完成判定用:见过又消失 = 压缩结束)
function closeCompact(): void {
  compactOpen.value = false
  compactErr.value = ''
}
// 完成:进度补满 + 绿色「已压缩」闪 ~1.3s,再回 idle(此时对话区已显示 Compacted 结果)。幂等:只认 running→done。
function finishCompact(): void {
  if (compactPhase.value !== 'running') return
  compactPhase.value = 'done'
  setTimeout(() => {
    if (compactPhase.value === 'done') compactPhase.value = 'idle'
  }, 1300)
}
// 取消:立刻收卡(置 idle)→ 随后 busy 翻转就不会被 watch 误判成"已压缩";再发 Esc 打断里世界的 Compacting。
function cancelCompact(): void {
  compactPhase.value = 'idle'
  sawRealPct.value = false
  raw('\x1b')
}
async function runCompact(): Promise<void> {
  if (compacting.value) return
  compacting.value = true
  compactErr.value = ''
  try {
    const instr = compactInstr.value.trim()
    const r = await fetch(sendkeysUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        session: tmuxName(props.sid),
        text: '/compact' + (instr ? ' ' + instr : ''),
        clear: true,
        enter: true,
      }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kind?: string }
    if (r.ok && j.ok) {
      compactOpen.value = false
      compactInstr.value = ''
      compactPhase.value = 'running'
      compactStartMs.value = Date.now()
      now.value = compactStartMs.value // 立即同步秒针,耗时从 0 起算(否则 now 可能滞后一拍)
      sawRealPct.value = false // 新一轮:清掉上轮的"见过百分比"标记,免得起步那一帧被误判成已完成
      setTimeout(() => props.reconnectAll(), 400) // 让「Compacting… NN%」进读屏,真百分比才进得来(同 /model 半开兜底)
      // 安全兜底:若 3s 内没进忙态(如「Not enough messages to compact」直接回 idle),收掉进度卡。
      setTimeout(() => {
        if (compactPhase.value === 'running' && !isBusy.value) compactPhase.value = 'idle'
      }, 3000)
    } else {
      compactErr.value =
        j.kind === 'stale'
          ? '会话已被取代,请回列表重进'
          : r.status === 409
            ? '当前不是输入态,稍后再试'
            : '压缩失败 (' + r.status + ')'
    }
  } catch {
    compactErr.value = '压缩失败:网络错误'
  } finally {
    compacting.value = false
  }
}

// ── /usage:用量富面板 ──
// 原生 /sendkeys 发 "/usage"(literal+Enter)→ 强制重连隐藏终端(扛 hub /term 半开假活,同 /model)
// → 轮询读屏:detectUsage 命中且**连续两拍解析结果一致**(面板有异步加载的数字/图表,不等稳定会读
// 到骨架)→ 提取统计行渲染 → Esc 关闭设备端浮层。数字全部来自读屏真值,不编造。
const usageOpen = ref(false)
const usageLoading = ref(false)
const usageErr = ref('')
const usageLines = ref<{ text: string; pct: number | null }[]>([])
let usageGen = 0
// 手机端全量一屏太长 → 按内容分组成 tab:额度(当前会话/本周条)、分析(用量构成/子代理/加油包)、
// 费用(总花费/各模型)。按已知小节标题切分,未识别的行跟随当前组;空组不显示 tab。
type UsageLine = { text: string; pct: number | null }
const usageTab = ref('额度')
const usageGroups = computed<Record<string, UsageLine[]>>(() => {
  const g: Record<string, UsageLine[]> = { 额度: [], 分析: [], 费用: [] }
  let cur = '费用' // 开头是 总花费/各模型用量
  for (const l of usageLines.value) {
    if (/^(当前会话|本周额度|本月)/.test(l.text)) cur = '额度'
    else if (/^(哪些在消耗|近 24 小时)/.test(l.text)) cur = '分析'
    g[cur].push(l)
  }
  return g
})
const usageTabs = computed(() => ['额度', '分析', '费用'].filter((t) => usageGroups.value[t].length))
const usageView = computed(() => usageGroups.value[usageTab.value] ?? []) // 关闭/重开使在途轮询作废
// 中文化:已知句式逐条翻译,未识别的原样保留(宁可漏译不可错译)。先剥掉 TUI 画的字符进度条
// (█▓░ 等),网页用自己的进度条渲染。
function zhUsage(raw: string): string {
  let t = raw.replace(/[█▉▊▋▌▍▎▏▓▒░⛁⛀⛶■▪]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  t = t.replace(/^Current session\b.*$/i, '当前会话')
  t = t.replace(/^Current week \(all models\).*$/i, '本周额度(全部模型)')
  t = t.replace(/^Current week \(Opus\).*$/i, '本周额度(Opus)')
  t = t.replace(/(\d{1,3})%\s*used/i, '已用 $1%')
  t = t.replace(/^Resets\s+(.+)$/i, '重置于 $1')
  t = t.replace(/\bat\s+(\d{1,2}(:\d{2})?(am|pm))/i, '$1')
  t = t.replace(/^What'?s contributing to your limits usage\??/i, '哪些在消耗你的额度?')
  t = t.replace(
    /^Approximate, based on local sessions on this machine.*$/i,
    '估算值:基于本机会话,不含其它设备或 claude.ai',
  )
  t = t.replace(
    /^Last\s*24h\b.*independent characteristics.*$/i,
    '近 24 小时 · 各项为独立特征,非用量拆分',
  )
  t = t.replace(/^Last\s*24h\b/i, '近 24 小时')
  t = t.replace(/(\d{1,3})%\s*of your usage came from\s*/i, '$1% 的用量来自 ')
  t = t.replace(/subagent-heavy sessions/i, '子代理密集型会话')
  t = t.replace(/long sessions/i, '长会话')
  t = t.replace(/(\d+)\s*day streak/i, '连续活跃 $1 天')
  t = t.replace(/(\d+)\s*active days?/i, '活跃 $1 天')
  t = t.replace(/^Total cost:?\s*/i, '总花费:')
  t = t.replace(/^Total duration:?\s*/i, '总时长:')
  t = t.replace(/^Usage by model:?\s*$/i, '各模型用量')
  t = t.replace(/^Current month\b.*$/i, '本月')
  // CDP 实测补充的句式(2026-06-11 真机面板抓取)
  t = t.replace(/^Current week \((.+?) only\).*$/i, '本周额度(仅 $1)')
  t = t.replace(/sessions? active for (\d+)\+\s*hours?/i, '活跃 $1+ 小时的会话')
  t = t.replace(
    /^These are often background\/loop sessions.*$/i,
    '这些通常是后台/循环会话,持续使用会快速累积',
  )
  t = t.replace(/(\d{1,3})%\s*of your usage was at\s*/i, '$1% 的用量发生在 ')
  t = t.replace(/>(\d+)k context/i, '>$1k 上下文')
  t = t.replace(
    /^Longer sessions are more expensive.*$/i,
    '长会话即使命中缓存也更贵:任务中途 /compact,任务之间 /clear',
  )
  t = t.replace(/subagents under\s*/i, '子代理 ')
  t = t.replace(/^Subagents % of usage$/i, '各子代理用量占比')
  t = t.replace(/^Usage credits$/i, '用量加油包')
  t = t.replace(/^Usage credits are off.*$/i, '用量加油包未开启 · /usage-credits 可开启')
  return t
}
// 从用量浮层屏幕里挑出有信息量的统计行(best-effort,同 SlashBar 时代的 parseUsageScreen);
// 行内含 "NN%" 的解析出百分比,渲染成小进度条。
function parseUsageLines(screen: string[]): { text: string; pct: number | null }[] {
  return screen
    .map((l) => l.trim())
    .filter((l) =>
      /%|Last\s*24h|usage|tokens|sessions?|cost|streak|active days|contributing|resets|current (week|month)/i.test(
        l,
      ),
    )
    // 噪声行:tab 栏(Settings Status Config Usage Stats)、孤立的小节名、操作提示。
    .filter(
      (l) =>
        !/esc to|to cancel|↑|↓|Settings\s+Status\s+Config/i.test(l) &&
        !/^(Session|Usage|Stats|Status|Config)$/i.test(l),
    )
    .map((l) => zhUsage(l))
    .filter((text) => text.length > 0)
    .map((text) => {
      const m = /(\d{1,3})%/.exec(text)
      return { text, pct: m ? Math.min(100, Number(m[1])) : null }
    })
}
async function openUsage(): Promise<void> {
  const gen = ++usageGen
  usageOpen.value = true
  usageLoading.value = true
  usageErr.value = ''
  usageLines.value = []
  usageTab.value = '额度'
  try {
    const r = await fetch(sendkeysUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ session: tmuxName(props.sid), text: '/usage', clear: true, enter: true }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kind?: string }
    if (!r.ok || !j.ok) {
      usageErr.value =
        j.kind === 'stale'
          ? '会话已被取代,请回列表重进'
          : r.status === 409
            ? '当前不是输入态,稍后再试'
            : '打开用量面板失败 (' + r.status + ')'
      return
    }
    setTimeout(() => props.reconnectAll(), 500) // 半开兜底:全量重绘才进得了读屏
    // 阶段一:等首屏就绪 —— detectUsage 命中且连续两拍解析一致(异步数字没加载完前屏会持续变)。
    let lastSig = ''
    let stable = 0
    let ready = false
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(300)
      if (gen !== usageGen) return // 已被关闭/重开
      const s = props.getScreen()
      if (!detectUsage(s)) continue
      const sig = JSON.stringify(parseUsageLines(s))
      if (sig === lastSig) {
        if (++stable >= 2) ready = true
      } else {
        lastSig = sig
        stable = 0
      }
    }
    if (!ready) {
      usageErr.value = '读取用量面板超时,请重试'
      return
    }
    // 阶段二:面板可滚、一屏装不下 → 逐步发 ↓ 下翻收全文。每步读两拍取交集(两拍都在的行才收,
    // 滤掉异步加载中的瞬时骨架),按首见顺序合并去重(滚动相邻帧大量重叠,文本相同即同一行);
    // 连续 3 步无新增 = 到底。边滚边渲染,用户能看到列表长出来。
    const seen = new Set<string>()
    const merged: { text: string; pct: number | null }[] = []
    const absorb = (lines: { text: string; pct: number | null }[]): number => {
      let added = 0
      for (const l of lines) {
        if (!seen.has(l.text)) {
          seen.add(l.text)
          merged.push(l)
          added++
        }
      }
      return added
    }
    absorb(parseUsageLines(props.getScreen()))
    usageLines.value = [...merged]
    usageLoading.value = false
    let dry = 0
    for (let step = 0; step < 30 && dry < 3; step++) {
      raw('\x1b[B\x1b[B\x1b[B\x1b[B') // ↓×4 / 步:步子太大可能整屏翻过去丢行
      await sleep(350)
      if (gen !== usageGen) return
      const a = parseUsageLines(props.getScreen())
      await sleep(250)
      if (gen !== usageGen) return
      const bset = new Set(parseUsageLines(props.getScreen()).map((x) => x.text))
      const settled = a.filter((x) => bset.has(x.text))
      if (!detectUsage(props.getScreen())) break // 浮层意外关闭(被打断等)→ 收尾
      dry = absorb(settled) > 0 ? 0 : dry + 1
      usageLines.value = [...merged]
    }
    // 阶段三:到底后再等两拍补「迟到的异步行」(图表/费用常在滚动后才填充),有新行就收。
    for (let i = 0; i < 2; i++) {
      await sleep(600)
      if (gen !== usageGen) return
      if (absorb(parseUsageLines(props.getScreen())) > 0) usageLines.value = [...merged]
    }
    raw('\x1b') // 读完即关设备端浮层,把输入态还回去
  } catch {
    usageErr.value = '打开用量面板失败:网络错误'
  } finally {
    if (gen === usageGen) usageLoading.value = false
  }
}
function closeUsage(): void {
  usageGen++ // 作废在途轮询
  if (usageLoading.value) raw('\x1b') // 还在读 → 浮层可能开着,顺手关掉
  usageOpen.value = false
  usageLoading.value = false
  usageErr.value = ''
}

// ── /config:设置富面板(只读)──
// 同 /usage 的读屏链路:/sendkeys 原生发命令 → 重连扛半开 → 等 detectConfig 首屏 → ↓ 下翻收全文
// (两拍交集滤瞬时帧)→ 中文化渲染 → Esc 关闭。列表 36 项(2026-06-11 真机逐屏抓取),
// 行格式「Label    value」(≥3 空格分隔);未识别的标签原样保留。
const CFG_ZH: Record<string, string> = {
  'Auto-compact': '自动压缩上下文',
  'Switch models when a message is flagged': '消息被标记时切换模型',
  'Show tips': '显示小贴士',
  'Reduce motion': '减少动效',
  'Thinking mode': '思考模式',
  'Prompt suggestions': '提示词建议',
  'Session recap': '会话摘要(recap)',
  'Rewind code (checkpoints)': '代码回滚(检查点)',
  'Dynamic workflows': '动态工作流',
  'Ultracode keyword trigger': 'Ultracode 关键词触发',
  'Verbose output': '详细输出',
  'Terminal progress bar': '终端进度条',
  'Show turn duration': '显示回合耗时',
  'Default permission mode': '默认权限模式',
  'Worktree base ref': 'Worktree 基准分支',
  'Use auto mode during plan': '计划模式中用自动权限',
  'Respect .gitignore in file picker': '文件选择器遵循 .gitignore',
  'Skip the /copy picker': '跳过 /copy 选择器',
  'Copy on select': '选中即复制',
  'Auto-scroll': '自动滚动',
  'Open agents view by default': '默认打开代理视图',
  '← opens agents': '← 键打开代理',
  'Auto-update channel': '自动更新通道',
  Theme: '主题',
  'Local notifications': '本地通知',
  'Push when actions required': '需操作时推送',
  'Push when Claude decides': 'Claude 自行决定推送',
  'Output style': '输出风格',
  Language: '语言',
  'Editor mode': '编辑器模式',
  'Show last response in external editor': '在外部编辑器看上条回复',
  'Show PR status footer': '显示 PR 状态栏',
  Model: '模型',
  'Auto-connect to IDE (external terminal)': '自动连接 IDE(外部终端)',
  'Claude in Chrome enabled by default': 'Chrome 里默认启用 Claude',
  'Enable Remote Control for all sessions': '所有会话启用远程控制',
}
const CFG_VAL_ZH: Record<string, string> = {
  true: '开',
  false: '关',
  default: '默认',
  'Dark mode': '深色',
  'Light mode': '浅色',
  Auto: '自动',
  'Auto mode': '自动模式',
  normal: '普通',
  'Default (English)': '默认(英文)',
}
interface CfgRow {
  label: string
  value: string
  flag: 'on' | 'off' | null // true/false 渲染成开关章;其余文本值
}
const cfgOpen = ref(false)
const cfgLoading = ref(false)
const cfgErr = ref('')
const cfgRows = ref<CfgRow[]>([])
let cfgGen = 0
function detectConfigScreen(s: string[]): boolean {
  return s.some((l) => /Search settings/i.test(l))
}
function parseCfgRows(screen: string[]): CfgRow[] {
  const out: CfgRow[] = []
  for (const raw of screen) {
    const l = raw.replace(/^\s*❯\s*/, '   ').trimEnd() // 选中行 ❯ → 补足缩进,别让它过不了下面的行匹配
    if (/Search settings|Settings\s+Status\s+Config|Space to change|Type to filter|Esc to|more (above|below)|[╭╰─│]/.test(l))
      continue
    const m = /^\s{2,}(\S.*?\S)\s{3,}(\S.*)$/.exec(l)
    if (!m) continue
    const label = m[1]
    const value = m[2].trim()
    out.push({
      label: CFG_ZH[label] ?? label,
      value: CFG_VAL_ZH[value] ?? value,
      flag: value === 'true' ? 'on' : value === 'false' ? 'off' : null,
    })
  }
  return out
}
async function openConfig(): Promise<void> {
  const gen = ++cfgGen
  cfgOpen.value = true
  cfgLoading.value = true
  cfgErr.value = ''
  cfgRows.value = []
  try {
    const r = await fetch(sendkeysUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ session: tmuxName(props.sid), text: '/config', clear: true, enter: true }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kind?: string }
    if (!r.ok || !j.ok) {
      cfgErr.value =
        j.kind === 'stale'
          ? '会话已被取代,请回列表重进'
          : r.status === 409
            ? '当前不是输入态,稍后再试'
            : '打开设置面板失败 (' + r.status + ')'
      return
    }
    setTimeout(() => props.reconnectAll(), 500)
    // 首屏就绪:detectConfig 命中且连续两拍解析一致。
    let lastSig = ''
    let stable = 0
    let ready = false
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(300)
      if (gen !== cfgGen) return
      const s = props.getScreen()
      if (!detectConfigScreen(s)) continue
      const sig = JSON.stringify(parseCfgRows(s))
      if (sig === lastSig) {
        if (++stable >= 2) ready = true
      } else {
        lastSig = sig
        stable = 0
      }
    }
    if (!ready) {
      cfgErr.value = '读取设置面板超时,请重试'
      return
    }
    // 下翻收全文:↓ 移动选中带动列表滚动;两拍交集,按 label 去重(label 唯一),连续 3 步无新增到底。
    const seen = new Set<string>()
    const merged: CfgRow[] = []
    const absorb = (rows: CfgRow[]): number => {
      let added = 0
      for (const row of rows) {
        if (!seen.has(row.label)) {
          seen.add(row.label)
          merged.push(row)
          added++
        }
      }
      return added
    }
    absorb(parseCfgRows(props.getScreen()))
    cfgRows.value = [...merged]
    cfgLoading.value = false
    let dry = 0
    for (let step = 0; step < 25 && dry < 4; step++) {
      // ↓ 必须逐个发、留间隔:连发会被 TUI 合并成一步(tmux 实测,一帧 4 个 ↓ 只动 1 行)。
      for (let k = 0; k < 4; k++) {
        raw('\x1b[B')
        await sleep(150)
        if (gen !== cfgGen) return
      }
      await sleep(250)
      if (gen !== cfgGen) return
      const a = parseCfgRows(props.getScreen())
      await sleep(250)
      if (gen !== cfgGen) return
      const bset = new Set(parseCfgRows(props.getScreen()).map((x) => x.label))
      if (!detectConfigScreen(props.getScreen())) break
      dry = absorb(a.filter((x) => bset.has(x.label))) > 0 ? 0 : dry + 1
      cfgRows.value = [...merged]
    }
    // 关闭:列表态 Esc 可能只退一层(清搜索/取消选择),还在面板就再 Esc(最多 3 次)。
    for (let i = 0; i < 3; i++) {
      raw('\x1b')
      await sleep(400)
      if (!detectConfigScreen(props.getScreen())) break
    }
  } catch {
    cfgErr.value = '打开设置面板失败:网络错误'
  } finally {
    if (gen === cfgGen) cfgLoading.value = false
  }
}
function closeConfig(): void {
  cfgGen++
  if (cfgLoading.value) raw('\x1b')
  cfgOpen.value = false
  cfgLoading.value = false
  cfgErr.value = ''
}

// ── /status:状态富面板(单屏 Label: value,无滚动)── 链路同 /usage(见 openUsage 注释)。
import { detectStatus } from '../../state/detectors/status'
import { detectStats } from '../../state/detectors/stats'
const ST_ZH: Record<string, string> = {
  Version: '版本',
  'Session name': '会话名',
  'Session ID': '会话 ID',
  cwd: '工作目录',
  'Login method': '登录方式',
  Organization: '组织',
  Email: '邮箱',
  Model: '模型',
  'MCP servers': 'MCP 服务器',
  'Setting sources': '设置来源',
}
function zhStatusVal(v: string): string {
  return v
    .replace(/Claude Max account/i, 'Claude Max 账号')
    .replace(/(\d+)\s*connected/i, '$1 已连接')
    .replace(/(\d+)\s*need auth/i, '$1 待认证')
    .replace(/(\d+)\s*disabled/i, '$1 已禁用')
    .replace(/User settings/i, '用户设置')
    .replace(/'s Organization/i, ' 的组织')
}
interface KvRow {
  label: string
  value: string
}
function parseStatusRows(screen: string[]): KvRow[] {
  const out: KvRow[] = []
  for (const raw of screen) {
    const l = raw.trimEnd()
    if (/Settings\s+Status\s+Config|Esc to/i.test(l)) continue
    const m = /^\s+([A-Za-z][\w ()]*?):\s{2,}(\S.*)$/.exec(l)
    if (!m) continue
    out.push({ label: ST_ZH[m[1]] ?? m[1], value: zhStatusVal(m[2].trim()) })
  }
  return out
}
const stOpen = ref(false)
const stLoading = ref(false)
const stErr = ref('')
const stRows = ref<KvRow[]>([])
let stGen = 0
// 等检测器命中且连续两拍解析一致;返回 false = 超时/已作废。openStatus/openStats 共用。
async function waitOverlay(
  gen: () => boolean,
  detect: (s: string[]) => boolean,
  sig: () => string,
): Promise<boolean> {
  let last = ''
  let stable = 0
  for (let i = 0; i < 60; i++) {
    await sleep(300)
    if (!gen()) return false
    if (!detect(props.getScreen())) continue
    const s = sig()
    if (s === last) {
      if (++stable >= 2) return true
    } else {
      last = s
      stable = 0
    }
  }
  return false
}
async function escUntilClosed(detect: (s: string[]) => boolean): Promise<void> {
  for (let i = 0; i < 3; i++) {
    raw('\x1b')
    await sleep(400)
    if (!detect(props.getScreen())) break
  }
}
async function sendOverlayCmd(cmd: string, setErr: (m: string) => void): Promise<boolean> {
  try {
    const r = await fetch(sendkeysUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ session: tmuxName(props.sid), text: cmd, clear: true, enter: true }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kind?: string }
    if (r.ok && j.ok) {
      setTimeout(() => props.reconnectAll(), 500) // 半开兜底
      return true
    }
    setErr(
      j.kind === 'stale'
        ? '会话已被取代,请回列表重进'
        : r.status === 409
          ? '当前不是输入态,稍后再试'
          : '打开面板失败 (' + r.status + ')',
    )
  } catch {
    setErr('打开面板失败:网络错误')
  }
  return false
}
async function openStatus(): Promise<void> {
  const gen = ++stGen
  stOpen.value = true
  stLoading.value = true
  stErr.value = ''
  stRows.value = []
  try {
    if (!(await sendOverlayCmd('/status', (m) => (stErr.value = m)))) return
    const ok = await waitOverlay(
      () => gen === stGen,
      detectStatus,
      () => JSON.stringify(parseStatusRows(props.getScreen())),
    )
    if (gen !== stGen) return
    if (!ok) {
      stErr.value = '读取状态面板超时,请重试'
      return
    }
    stRows.value = parseStatusRows(props.getScreen())
    await escUntilClosed(detectStatus)
  } finally {
    if (gen === stGen) stLoading.value = false
  }
}
function closeStatus(): void {
  stGen++
  if (stLoading.value) raw('\x1b')
  stOpen.value = false
  stLoading.value = false
  stErr.value = ''
}

// ── /stats:活跃统计富面板 ── 无原生 /stats 命令:经 /status 开浮层 → →×3 切到 Stats tab。
// Overview 子页 = 日历热力图(等宽 <pre> 原样渲染)+ 统计 KV;PageDown 取折叠线下的统计行;
// Tab 切 Models 子页抓「Tokens per Day」ASCII 图(同样 <pre>)。
const STATS_ZH: Record<string, string> = {
  'Favorite model': '最常用模型',
  'Total tokens': '总 token',
  Sessions: '会话数',
  'Active days': '活跃天数',
  'Most active day': '最活跃日',
  'Longest session': '最长会话',
  'Longest streak': '最长连续',
  'Current streak': '当前连续',
}
const statsOpen = ref(false)
const statsLoading = ref(false)
const statsErr = ref('')
const statsRows = ref<KvRow[]>([])
const statsHeat = ref('') // 热力图(pre)
const statsChart = ref('') // Tokens per Day(pre)
let statsGen = 0
// 统计 KV:一行可能有两列「Label: v   Label2: v2」,全局正则逐对提取。
function parseStatsRows(screen: string[]): KvRow[] {
  const out: KvRow[] = []
  for (const l of screen) {
    if (/Settings\s+Status\s+Config|All time|Less .* More|tabs ·/i.test(l)) continue
    for (const m of l.matchAll(/([A-Za-z][A-Za-z ]+?):\s+(\S[^ ]*(?: \S[^ ]*)*?)(?=\s{3,}|\s*$)/g)) {
      const label = m[1].trim()
      if (STATS_ZH[label]) out.push({ label: STATS_ZH[label], value: m[2].trim() })
    }
  }
  return out
}
// 热力图/图表区:从子tab行之后到「All time」行之前的原样文本(剥行尾空白)。
function grabArt(screen: string[]): string {
  const start = screen.findIndex((l) => /\bOverview\s+Models\b/.test(l))
  if (start < 0) return ''
  const rest = screen.slice(start + 1)
  const end = rest.findIndex((l) => /All time ·/.test(l))
  const lines = (end >= 0 ? rest.slice(0, end) : rest)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, arr) => l || (arr[i - 1] && arr[i + 1])) // 去掉首尾连续空行
  // 去公共缩进:左侧大段空白白白撑宽 <pre>,手机上必出横向滚动条。
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => (/^ */.exec(l) as RegExpExecArray)[0].length),
  )
  return lines
    .map((l) => l.slice(indent))
    .join('\n')
    .trim()
}
async function openStats(): Promise<void> {
  const gen = ++statsGen
  statsOpen.value = true
  statsLoading.value = true
  statsErr.value = ''
  statsRows.value = []
  statsHeat.value = ''
  statsChart.value = ''
  try {
    if (!(await sendOverlayCmd('/status', (m) => (statsErr.value = m)))) return
    if (!(await waitOverlay(() => gen === statsGen, detectStatus, () => 'status'))) {
      if (gen === statsGen) statsErr.value = '打开浮层超时,请重试'
      return
    }
    // 切到 Stats tab:焦点不一定在 tab 栏、切换次序也不可预测(tmux 实测同样按键时灵时不灵)
    // → 探测驱动:Up 聚焦 tab 栏后逐次 Right,每步查 detectStats,最多 8 次。
    raw('\x1b[A')
    await sleep(400)
    for (let i = 0; i < 8 && !detectStats(props.getScreen()); i++) {
      raw('\x1b[C')
      await sleep(450)
      if (gen !== statsGen) return
    }
    const ok = await waitOverlay(
      () => gen === statsGen,
      detectStats,
      () => grabArt(props.getScreen()),
    )
    if (gen !== statsGen) return
    if (!ok) {
      statsErr.value = '读取统计面板超时,请重试'
      return
    }
    statsHeat.value = grabArt(props.getScreen())
    const rows = parseStatsRows(props.getScreen())
    // PageDown 取折叠线下的统计行(Sessions/Active days/streak…)
    raw('\x1b[6~')
    await sleep(700)
    if (gen !== statsGen) return
    for (const r2 of parseStatsRows(props.getScreen())) {
      if (!rows.some((x) => x.label === r2.label)) rows.push(r2)
    }
    statsRows.value = rows
    statsLoading.value = false
    // Tab 切 Models 子页抓图(失败不致命,图留空)
    raw('\x1b[5~') // PageUp 回顶
    await sleep(500)
    // 子页切换(tmux 实测):Down 进入子tab区 → Right 切到 Models;Tab 是切主 tab,会跳走。
    raw('\x1b[B')
    await sleep(400)
    raw('\x1b[C')
    // 轮询等 Models 子页渲染出与热力图不同的图(图表数据异步)
    for (let i = 0; i < 12; i++) {
      await sleep(400)
      if (gen !== statsGen) return
      const chart = grabArt(props.getScreen())
      if (chart && chart !== statsHeat.value) {
        statsChart.value = chart
        break
      }
    }
    await escUntilClosed(detectStats)
  } finally {
    if (gen === statsGen) statsLoading.value = false
  }
}
function closeStats(): void {
  statsGen++
  if (statsLoading.value) raw('\x1b')
  statsOpen.value = false
  statsLoading.value = false
  statsErr.value = ''
}

// ── 斜杠命令面板:点「/」弹出全量内置命令清单(分页),取代「插入一个斜杠」。──
// 清单 = claude v2.1.173 真实 `/` 补全面板逐帧抓取所得(剔除本机插件 skills),共 79 条内置命令;
// 每条的「结果形态」在临时会话逐个实跑验证(编号菜单/打印/生成轮/TUI 浮层)。⚠️ /init 已从原生
// 消失(补全会误中 /install-*),故不在清单。kind:'panel' 路由到已有富面板;'native' 经 /sendkeys
// 原生直发(literal 打字 + Enter,精确名必中 —— 实测 /usage 不会被 /usage-credits 抢);'fill' 把
// 「/cmd 」填入输入框等用户补参数。render=true 仅指**网页已有专属开发控件**:富面板(/model
// /compact)、专属卡片(/context → ContextCard)、编号菜单 → 通用可点选控件(逐个实测确认);
// 打印型/生成轮虽然结果也进聊天,但只是普通文本、无控件 → 一律算 false(需终端/无控件)。
// confirm 有值=危险命令(红色),点击先弹 ConfirmDialog 确认才执行。
interface SlashPreset {
  cmd: string
  desc: string
  kind: 'panel' | 'native' | 'fill'
  render: boolean
  confirm?: string
}
// ── 权重(排序用,大者靠前)。规则:基准 30;按「UI 渲染能力」与「使用频率」两轴加分 ──
//   ① 富面板(panel,本 UI 专属交互)        90+
//   ② 专属卡片 / 可点选控件(render=true)   55–85(再按常用度内部分档)
//   ③ 无控件但高频(日常会话操作/审查/导航) 45–85
//   ④ 一般命令                              30(缺省,不入表)
//   ⑤ 设备端才有意义 / 营销·低频            10–25
// 危险命令不降权(/clear 很常用),靠 ConfirmDialog 兜底防误触。
const SLASH_WEIGHT: Record<string, number> = {
  // ① 富面板
  '/model': 100,
  '/compact': 95,
  // ② 有控件(按常用度)
  '/context': 85,
  '/permissions': 70,
  '/export': 60,
  '/theme': 58,
  '/sandbox': 56,
  '/advisor': 55,
  '/hooks': 50,
  '/release-notes': 45,
  '/usage-credits': 40,
  // ③ 高频无控件
  '/clear': 85,
  '/plan': 72,
  '/usage': 70,
  '/resume': 65,
  '/code-review': 65,
  '/status': 60,
  '/stats': 45,
  '/rename': 58,
  '/cd': 56,
  '/diff': 55,
  '/help': 54,
  '/copy': 52,
  '/mcp': 50,
  '/agents': 50,
  '/skills': 50,
  '/tasks': 48,
  '/rewind': 48,
  '/focus': 45,
  '/add-dir': 45,
  '/fork': 44,
  '/btw': 44,
  '/config': 62,
  '/memory': 40,
  '/goal': 40,
  '/debug': 38,
  '/ultraplan': 36,
  '/exit': 35,
  '/background': 35,
  '/branch': 34,
  '/workflows': 33,
  '/recap': 32,
  '/fast': 32,
  // ⑤ 设备端 / 低频 / 营销
  '/teleport': 25,
  '/doctor': 25,
  '/feedback': 25,
  '/effort': 24,
  '/color': 24,
  '/tui': 22,
  '/reload-plugins': 20,
  '/reload-skills': 20,
  '/remote-control': 20,
  '/ide': 20,
  '/login': 18,
  '/logout': 15,
  '/keybindings': 15,
  '/terminal-setup': 15,
  '/scroll-speed': 15,
  '/privacy-settings': 15,
  '/remote-env': 15,
  '/chrome': 15,
  '/web-setup': 14,
  '/install-github-app': 14,
  '/install-slack-app': 14,
  '/desktop': 12,
  '/voice': 12,
  '/powerup': 12,
  '/mobile': 10,
  '/radio': 10,
  '/stickers': 10,
  '/passes': 10,
  '/upgrade': 10,
}
const weightOf = (p: SlashPreset): number => SLASH_WEIGHT[p.cmd] ?? 30
const SLASH_PRESETS: SlashPreset[] = [
  // ── 有控件:富面板(本 UI 专属交互)──
  { cmd: '/model', desc: '切换模型与思考力度', kind: 'panel', render: true },
  { cmd: '/compact', desc: '压缩对话、释放上下文(真·进度条)', kind: 'panel', render: true },
  // ── 有控件:专属卡片 ──
  { cmd: '/context', desc: '上下文用量彩格图(专属卡片)', kind: 'native', render: true },
  // ── 有控件:编号菜单 → 通用可点选控件(逐个实测)──
  { cmd: '/theme', desc: '切换终端配色主题', kind: 'native', render: true },
  { cmd: '/permissions', desc: '管理工具权限规则', kind: 'native', render: true },
  { cmd: '/sandbox', desc: '配置 Bash 沙箱模式', kind: 'native', render: true },
  { cmd: '/advisor', desc: '设顾问模型(关键时刻请强模型把关)', kind: 'native', render: true },
  { cmd: '/hooks', desc: '查看 hooks 配置(只读)', kind: 'native', render: true },
  { cmd: '/export', desc: '导出对话(剪贴板 / 文件)', kind: 'native', render: true },
  { cmd: '/release-notes', desc: '查看版本更新日志', kind: 'native', render: true },
  { cmd: '/usage-credits', desc: '用量加油包开关', kind: 'native', render: true },
  // ── 打印型(实测输出进聊天文本,但无专属控件 → 不算「有控件」)──
  { cmd: '/plan', desc: '开启计划模式 / 查看当前计划', kind: 'native', render: false },
  { cmd: '/focus', desc: '开关聚焦视图', kind: 'native', render: false },
  { cmd: '/color', desc: '设置会话提示色', kind: 'native', render: false },
  { cmd: '/rename', desc: '重命名会话(直发 = 自动起名)', kind: 'native', render: false },
  { cmd: '/copy', desc: '复制上条回复(设备剪贴板 + 写文件)', kind: 'native', render: false },
  { cmd: '/tui', desc: '终端渲染器(default | fullscreen)', kind: 'native', render: false },
  { cmd: '/cd', desc: '换工作目录(补路径)', kind: 'fill', render: false },
  { cmd: '/add-dir', desc: '新增工作目录(补路径)', kind: 'fill', render: false },
  { cmd: '/goal', desc: '设停止前必须达成的目标(补条件)', kind: 'fill', render: false },
  // ── 生成轮(回复进聊天,无专属控件)──
  { cmd: '/code-review', desc: '审查当前改动(bug + 可简化点)', kind: 'native', render: false },
  { cmd: '/debug', desc: '开调试日志并自助诊断', kind: 'native', render: false },
  { cmd: '/claude-api', desc: 'Claude API 开发参考(注入给模型)', kind: 'native', render: false },
  { cmd: '/autofix-pr', desc: '盯当前 PR 并自动修问题', kind: 'native', render: false },
  { cmd: '/update-config', desc: '配置 harness 行为(补描述)', kind: 'fill', render: false },
  { cmd: '/deep-research', desc: '深度研究工作流(补课题)', kind: 'fill', render: false },
  { cmd: '/batch', desc: '大规模并行改动(补任务)', kind: 'fill', render: false },
  { cmd: '/loop', desc: '定时循环跑提示/命令(补内容)', kind: 'fill', render: false },
  { cmd: '/ultraplan', desc: '云端起草可编辑计划(数分钟)', kind: 'native', render: false },
  {
    cmd: '/ultrareview',
    desc: '云端多代理查 bug(约 5-10 分钟)',
    kind: 'native',
    render: false,
    confirm: '云端审查按用量计费(约 $5-25)',
  },
  // ── TUI 浮层 / 全屏(实测非编号,网页渲染不了 → 需开终端看)──
  { cmd: '/usage', desc: '用量 / 花费 / 活跃统计(读屏渲染)', kind: 'panel', render: true },
  { cmd: '/status', desc: '状态总览(版本/账号/模型)', kind: 'panel', render: true },
  { cmd: '/stats', desc: '活跃统计(热力图/每日 token)', kind: 'panel', render: true },
  { cmd: '/config', desc: '设置总览(读屏渲染,只读)', kind: 'panel', render: true },
  { cmd: '/mcp', desc: '管理 MCP 服务器', kind: 'native', render: false },
  { cmd: '/plugin', desc: '管理插件', kind: 'native', render: false },
  { cmd: '/agents', desc: '子代理管理(运行中 / 库)', kind: 'native', render: false },
  { cmd: '/skills', desc: '技能列表与开关', kind: 'native', render: false },
  { cmd: '/help', desc: '帮助与全部命令', kind: 'native', render: false },
  { cmd: '/diff', desc: '浏览未提交改动', kind: 'native', render: false },
  { cmd: '/tasks', desc: '后台任务面板', kind: 'native', render: false },
  { cmd: '/workflows', desc: '浏览运行中 / 已完成工作流', kind: 'native', render: false },
  { cmd: '/resume', desc: '恢复历史会话(全屏选择器)', kind: 'native', render: false },
  { cmd: '/rewind', desc: '回滚代码 / 对话到历史点', kind: 'native', render: false },
  { cmd: '/recap', desc: '生成一句话会话摘要(进状态栏)', kind: 'native', render: false },
  { cmd: '/effort', desc: '力度滑杆(建议直接用 /model 面板)', kind: 'native', render: false },
  { cmd: '/fast', desc: '快速模式(需用量加油包)', kind: 'native', render: false },
  { cmd: '/btw', desc: '不打断主线的快速侧问(补问题)', kind: 'fill', render: false },
  { cmd: '/fork', desc: '派生后台代理继承全对话(补任务)', kind: 'fill', render: false },
  {
    cmd: '/branch',
    desc: '从当前点派生新会话',
    kind: 'native',
    render: false,
    confirm: '会派生新会话,本页面可能失效',
  },
  { cmd: '/scroll-speed', desc: '滚轮速度调节(设备终端)', kind: 'native', render: false },
  { cmd: '/privacy-settings', desc: '隐私设置', kind: 'native', render: false },
  { cmd: '/remote-env', desc: '云代理默认环境', kind: 'native', render: false },
  { cmd: '/remote-control', desc: '手机 / claude.ai 远程控制本会话', kind: 'native', render: false },
  { cmd: '/ide', desc: 'IDE 集成管理(设备端)', kind: 'native', render: false },
  { cmd: '/chrome', desc: 'Chrome 扩展设置(设备端)', kind: 'native', render: false },
  { cmd: '/desktop', desc: '转到 Claude Desktop 继续(设备端)', kind: 'native', render: false },
  { cmd: '/mobile', desc: '手机 App 下载二维码', kind: 'native', render: false },
  { cmd: '/powerup', desc: '功能速成互动课', kind: 'native', render: false },
  { cmd: '/doctor', desc: '安装自检与诊断', kind: 'native', render: false },
  { cmd: '/feedback', desc: '提交反馈 / 报 bug', kind: 'native', render: false },
  { cmd: '/terminal-setup', desc: '安装 Shift+Enter 换行键位', kind: 'native', render: false },
  {
    cmd: '/keybindings',
    desc: '打开快捷键配置文件',
    kind: 'native',
    render: false,
    confirm: '会在设备终端里打开编辑器',
  },
  {
    cmd: '/memory',
    desc: '打开记忆文件',
    kind: 'native',
    render: false,
    confirm: '会在设备终端里打开编辑器',
  },
  { cmd: '/voice', desc: '语音模式开关(设备端)', kind: 'native', render: false },
  { cmd: '/radio', desc: 'Claude FM 电台(设备端音频)', kind: 'native', render: false },
  { cmd: '/stickers', desc: '订购 Claude Code 贴纸', kind: 'native', render: false },
  { cmd: '/passes', desc: '送朋友一周 Claude Code', kind: 'native', render: false },
  { cmd: '/upgrade', desc: '升级 Max 套餐', kind: 'native', render: false },
  { cmd: '/web-setup', desc: '配置 Claude Code on the web', kind: 'native', render: false },
  { cmd: '/install-github-app', desc: '装 GitHub Actions 应用', kind: 'native', render: false },
  { cmd: '/install-slack-app', desc: '装 Slack 应用', kind: 'native', render: false },
  { cmd: '/teleport', desc: '接管 claude.ai 上的会话', kind: 'native', render: false },
  { cmd: '/login', desc: '登录 Anthropic 账号(设备端交互)', kind: 'native', render: false },
  { cmd: '/reload-plugins', desc: '重载插件改动', kind: 'native', render: false },
  { cmd: '/reload-skills', desc: '重载磁盘上的技能改动', kind: 'native', render: false },
  // ── 危险命令(二次确认,集中尾页防误触)──
  {
    cmd: '/clear',
    desc: '清空上下文、换新会话',
    kind: 'native',
    render: false,
    confirm: '会清空当前对话上下文',
  },
  {
    cmd: '/background',
    desc: '会话转后台、释放终端',
    kind: 'native',
    render: false,
    confirm: '会话将转入后台',
  },
  {
    cmd: '/exit',
    desc: '退出 Claude CLI',
    kind: 'native',
    render: false,
    confirm: '退出后本会话结束',
  },
  {
    cmd: '/logout',
    desc: '登出 Anthropic 账号',
    kind: 'native',
    render: false,
    confirm: '将登出设备上的账号!',
  },
]
// 过滤:输入框模糊匹配 cmd(英)与 desc(中)。子序列匹配 —— 查询字符按序散落在目标里即中,
// 英文是经典 fuzzy("ctx" 中 /context),中文同样成立("切模" 中「切换模型」);多词(空格分隔)
// 须各词命中(cmd 或 desc 任一)。
const slashQuery = ref('')
function fuzzyHit(q: string, s: string): boolean {
  let i = 0
  const qa = [...q]
  for (const ch of s) {
    if (ch === qa[i] && ++i >= qa.length) return true
  }
  return false
}
// 经典 Levenshtein(字符级,中文按码点)。
function lev(a: string[], b: string[]): number {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}
// 排序分 = 查询词对目标的「最佳同长窗口」编辑距离(滑窗取最小,等价于找 s 里跟 q 最像的片段;
// "clea" 对 /clear 距离 0、对 /claude-api 距离 1),再加微小位置惩罚(越靠前越好,前缀命中优先)。
function bestDist(q: string[], s: string): number {
  const sa = [...s]
  if (sa.length <= q.length) return lev(q, sa)
  let best = Infinity
  for (let i = 0; i + q.length <= sa.length; i++) {
    const d = lev(q, sa.slice(i, i + q.length)) + i * 0.01
    if (d < best) best = d
  }
  return best
}
const slashFiltered = computed(() => {
  const q = slashQuery.value.trim().toLowerCase()
  // 无查询词:纯按权重降序(同权保持清单原序,sort 稳定)。
  if (!q) return [...SLASH_PRESETS].sort((a, b) => weightOf(b) - weightOf(a))
  const words = q.split(/\s+/)
  // 先模糊筛(子序列),再按编辑距离升序排:cmd 命中比 desc 命中更靠前(desc 加 0.5 偏置);
  // 距离同分时按权重降序。
  return SLASH_PRESETS.filter((p) => {
    const cmd = p.cmd.toLowerCase()
    const desc = p.desc.toLowerCase()
    return words.every((w) => fuzzyHit(w, cmd) || fuzzyHit(w, desc))
  })
    .map((p, i) => {
      const qa = [...q]
      const score = Math.min(bestDist(qa, p.cmd.slice(1).toLowerCase()), bestDist(qa, p.desc.toLowerCase()) + 0.5)
      return { p, score, i }
    })
    .sort((a, b) => a.score - b.score || weightOf(b.p) - weightOf(a.p) || a.i - b.i)
    .map((x) => x.p)
})
// 分页:对过滤结果按每页 8 条切;打开面板/改过滤词回到第 1 页。
const SLASH_PER_PAGE = 8
const slashPage = ref(0)
const slashPages = computed(() =>
  Math.max(1, Math.ceil(slashFiltered.value.length / SLASH_PER_PAGE)),
)
const slashView = computed(() =>
  slashFiltered.value.slice(
    slashPage.value * SLASH_PER_PAGE,
    (slashPage.value + 1) * SLASH_PER_PAGE,
  ),
)
const slashOpen = ref(false)
const slashBusy = ref('') // 正在原生执行的命令(防重复点 + 行内转圈)
const slashErr = ref('')
const slashConfirm = ref<SlashPreset | null>(null) // 危险命令待确认 → 弹 ConfirmDialog
watch(slashQuery, () => {
  slashPage.value = 0
})
function openSlash(): void {
  slashErr.value = ''
  slashConfirm.value = null
  slashQuery.value = ''
  slashPage.value = 0
  slashOpen.value = true
}
function closeSlash(): void {
  slashOpen.value = false
  slashErr.value = ''
  slashConfirm.value = null
}
function confirmSlash(): void {
  const p = slashConfirm.value
  if (!p) return
  slashConfirm.value = null
  void sendNativeSlash(p.cmd)
}
// 选中一条预置:面板类路由到富面板;fill 类填回输入框补参数;原生类直发(危险命令先二次确认)。
function runSlash(p: SlashPreset): void {
  if (slashBusy.value) return
  if (p.kind === 'panel') {
    closeSlash()
    if (p.cmd === '/model') void openModelMenu()
    else if (p.cmd === '/compact') compactOpen.value = true
    else if (p.cmd === '/usage') void openUsage()
    else if (p.cmd === '/config') void openConfig()
    else if (p.cmd === '/status') void openStatus()
    else if (p.cmd === '/stats') void openStats()
    return
  }
  if (p.kind === 'fill') {
    closeSlash()
    text.value = p.cmd + ' ' // 留尾空格,直接补参数(同手动输入路径)
    ta.value?.focus()
    autogrow()
    return
  }
  if (p.confirm) {
    slashConfirm.value = p // 危险命令:弹确认对话框,确认才发
    return
  }
  void sendNativeSlash(p.cmd)
}
async function sendNativeSlash(cmd: string): Promise<void> {
  slashBusy.value = cmd
  slashErr.value = ''
  try {
    const r = await fetch(sendkeysUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ session: tmuxName(props.sid), text: cmd, clear: true, enter: true }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kind?: string }
    if (r.ok && j.ok) {
      closeSlash()
      setTimeout(() => props.reconnectAll(), 450) // 让命令结果(忙态/菜单/清屏)进读屏环路(同半开兜底)
    } else {
      slashErr.value =
        j.kind === 'stale'
          ? '会话已被取代,请回列表重进'
          : r.status === 409
            ? '当前不是输入态,稍后再试'
            : '执行失败 (' + r.status + ')'
    }
  } catch {
    slashErr.value = '执行失败:网络错误'
  } finally {
    slashBusy.value = ''
  }
}
// 手动输入:回到输入框自己打命令(覆盖预置之外的一切斜杠命令)。
function manualSlash(): void {
  closeSlash()
  if (!text.value.startsWith('/')) text.value = '/' + text.value
  ta.value?.focus()
  autogrow()
}

// 断联封锁:终端(tmux ws)或事件流(jsonl sse)任一断了,状态/发送都不可靠 → 换成重连条,禁止一切操作。
// connected=false 是可信的(onclose 已发生);=true 可能滞后(移动端后台回来),那一侧仍由 ensureLive 兜底。
// 刚断开的前几秒先按「连接中…」展示(自动重连大多立刻成功,别闪红);超时仍断 → 警示 + 手动重连。
// termless(会话不在 tmux 中,无 pane 可控)另案处理:终端「连不上」是常态而非故障,
// 不进重连流程 —— busy 照常展示(观看),idle 显示只读提示;发送一律封锁。
const linkDown = computed(() => !props.termless && (!props.connected || !props.jsonlConnected))
const downSince = ref(0)
const retrying = ref(false)
watch(
  linkDown,
  (d) => {
    downSince.value = d ? Date.now() : 0
    if (!d) retrying.value = false
  },
  { immediate: true },
)
const downLong = computed(() => downSince.value > 0 && now.value - downSince.value > 3000)
const downWhat = computed(() => {
  const parts: string[] = []
  if (!props.connected) parts.push('终端')
  if (!props.jsonlConnected) parts.push('事件流')
  return parts.join('与')
})
function retry() {
  retrying.value = true
  props.reconnectAll()
  setTimeout(() => (retrying.value = false), 3000) // 没连上 → 放开按钮再试
}

// 接管流(termless 只读条上):两步确认 → POST /takeover → 等 /sessions 轮询翻 live,
// 只读条整体消失、自动进入正常可控状态。失败(如「进程定位不到但会话还活跃」被节点 409 拒)→ 显示原因。
const takeArmed = ref(false)
const takingOver = ref(false)
const takeErr = ref('')
async function doTakeover() {
  takeArmed.value = false
  takingOver.value = true
  takeErr.value = ''
  try {
    await props.takeover()
  } catch (e) {
    takeErr.value = e instanceof Error ? e.message : String(e)
    takingOver.value = false
  }
}
watch(
  () => props.termless,
  (t) => {
    if (!t) {
      takingOver.value = false // 接管成功落地(live 翻真)→ 复位,下次再见到只读条是全新状态
      takeArmed.value = false
      takeErr.value = ''
    }
  },
)
// 忙(generating/awaiting-tool)→ 走停止按钮,不发;断联/只读 → 输入框已被替换,这里再兜一层。
const canSend = computed(
  () => (st.value === 'idle' || st.value === 'unknown') && !linkDown.value && !props.termless,
)
// 设备端正开着 TUI 浮层(/usage /config 等「无渲染」命令的结果)→ 聊天页看不到内容,
// 给一个「Esc 关闭面板」逃生口,否则用户被锁在「非输入态」出不来。
const OVERLAY_STATES = ['usage', 'help', 'status', 'config', 'stats', 'mcp', 'plugin']
const overlayUp = computed(() => OVERLAY_STATES.includes(st.value ?? '') && !props.termless)
const isBusy = computed(
  () => st.value === 'generating' || st.value === 'awaiting-tool' || busy.value || apiBusy.value,
)
// 观测到「闲→忙」跳变:用浏览器钟为本回合耗时起算(busyMeta 据此现算 —— 纯浏览器钟,无设备/浏览器
// 时钟偏移)。「忙→闲」时若正在压缩 → 判定压缩完成,进度条收尾闪「已压缩」。
const busyStartMs = ref(0)
watch(isBusy, (nowB, prevB) => {
  if (nowB && !prevB) {
    busyStartMs.value = Date.now()
    now.value = busyStartMs.value // 同步秒针,耗时从 0 起算
  }
  if (prevB && !nowB && compactPhase.value === 'running') finishCompact()
})

// 真·压缩百分比(读屏):state.compactPct = 屏上「Compacting conversation… NN%」解析所得,null=没在压缩。
// 这是进度条的权威数据源。watch 据它驱动整条生命周期 —— 连原生 TUI(非本 UI)触发的压缩也照样起卡显示。
const realPct = computed(() => props.state.compactPct)
watch(realPct, (pct) => {
  if (pct != null) {
    sawRealPct.value = true
    if (compactPhase.value === 'idle') {
      // 屏上一出现「Compacting…」就起卡(压缩可能由原生终端触发,本 UI 没点过)。
      compactPhase.value = 'running'
      compactStartMs.value = Date.now()
      now.value = compactStartMs.value
    }
  } else if (compactPhase.value === 'running' && sawRealPct.value) {
    finishCompact() // 见过百分比、现在「Compacting…」行没了 = 压缩结束 → 收尾闪「已压缩」
  }
})

// select 态:claude 弹着选择菜单(恢复摘要 / 信任目录 / 选模型 / 权限询问…)。chat 终端在屏外,
// 用户看不到对话框 → 把解析出的选项渲染成可点按钮;另给方向键/Enter/Esc,屏幕轮询会把新高亮
// 实时回灌(cur 样式跟着动),形成 WYSIWYG 反馈。
const isSelect = computed(() => st.value === 'select')
const selView = computed(() => props.state.select)
// 模型菜单 → 单面板(模型列表 + 力度滑块,本地全选好,确认才一次性提交);其它 select 走简洁单选。
const isModelMenu = computed(() => !!selView.value?.model)

// 力度 6 档。EFFORT_DISPLAY:滑块从左到右的升序展示;EFFORT_RING:设备菜单 ←/→ 的真实环序
// (Left=+1,实测枚举所得),提交时据此算最短键数,再 cycle-until-match 兜底纠偏。
const EFFORT_DISPLAY = ['Low', 'Medium', 'High', 'xHigh', 'Max', 'Ultracode']
const EFFORT_RING = ['xHigh', 'High', 'Medium', 'Low', 'Ultracode', 'Max']
function normEffort(e?: string): string {
  if (!e) return ''
  return EFFORT_DISPLAY.find((d) => d.toLowerCase() === e.toLowerCase()) || e
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// 本地选择(不发键):所选模型行号 + 所选力度档。
const pickModelNum = ref<number | null>(null)
const pickEffort = ref('')
// 用户是否手动点选过 —— 没选过就「实时跟随」里世界真实当前(❯ 模型 / effort 行),选过则锁住本地值。
// 关键:不在面板打开首帧就 latch 默认值(那时 ❯/effort 行可能还没渲染好,会 latch 到错的默认),
// 而是持续跟随到用户第一次点选为止 —— 默认值因此始终等于真实当前,且会随首帧抖动自我纠正。
const modelTouched = ref(false)
const effortTouched = ref(false)
const submitting = ref(false)
const submitErr = ref('')
watch(
  [isSelect, selView],
  () => {
    if (!isSelect.value) {
      pickModelNum.value = null
      pickEffort.value = ''
      modelTouched.value = false
      effortTouched.value = false
      submitErr.value = ''
      return
    }
    if (!modelTouched.value) {
      const cur = selView.value?.options.find((o) => o.current)
      if (cur) pickModelNum.value = cur.num // 仅在确有当前项时跟随;解析不到就不乱默认到第 1 项
    }
    if (!effortTouched.value) {
      const e = normEffort(selView.value?.effort)
      if (e) pickEffort.value = e
    }
  },
  { immediate: true },
)
function chooseModel(num: number): void {
  pickModelNum.value = num
  modelTouched.value = true
}
function chooseEffort(lv: string): void {
  pickEffort.value = lv
  effortTouched.value = true
}
// TUI 选项文本用多空格做列对齐:拆成「名称」+「描述」,渲染才简洁。
function optName(text: string): string {
  return text
    .split(/\s{2,}/)[0]
    .replace(/\s*✔\s*$/, '')
    .trim()
}
function optDesc(text: string): string {
  return text
    .split(/\s{2,}/)
    .slice(1)
    .join(' ')
    .trim()
}
async function selRaw(seq: string): Promise<void> {
  await props.ensureLive?.()
  raw(seq)
}
// driveCursor — 闭环驱动 ❯ 到目标行:每次只发一个方向键(连发 chunk 会被 TUI 合并丢键,
// /config 下翻实测),发完读屏验证;连续两步高亮纹丝不动 = 按键没生效(半开假活/菜单已关)。
const curNum = () => props.state.select?.options.find((o) => o.current)?.num ?? null
async function driveCursor(num: number): Promise<'ok' | 'stuck' | 'gone'> {
  let still = 0
  for (let i = 0; i < 24; i++) {
    const cur = curNum()
    if (cur == null) return 'gone' // 菜单关了/解析不到
    if (cur === num) return 'ok'
    await selRaw(cur < num ? '\x1b[B' : '\x1b[A')
    await sleep(180)
    if (curNum() === cur) {
      if (++still >= 2) return 'stuck' // 两步没动:键到不了设备或屏冻结
    } else {
      still = 0
    }
  }
  return curNum() === num ? 'ok' : 'stuck'
}
// 取消:Esc 后验证菜单真的关了;没关(半开假活吞键)→ 强制重连取全量重绘再 Esc,最多两轮。
const selBusy = ref(false)
async function cancelSelection(): Promise<void> {
  if (selBusy.value) return
  selBusy.value = true
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await selRaw('\x1b')
      for (let i = 0; i < 6; i++) {
        await sleep(250)
        if (props.state.status !== 'select') return
      }
      props.reconnectAll() // 1.5s 仍在 select:屏可能冻结 → 重连刷新真实状态再试
      await sleep(1200)
      if (props.state.status !== 'select') return
    }
  } finally {
    selBusy.value = false
  }
}

// 一次性提交:把里世界菜单驱动到「所选模型 + 所选力度」并确认,再校验菜单已关闭。
// 全程在确认时才发键(浏览期间纯本地),杜绝边选边发的抖动/脱机。
async function submitModel(): Promise<void> {
  if (submitting.value || pickModelNum.value == null) return
  submitting.value = true
  submitErr.value = ''
  try {
    // 1) ❯ 移到所选模型 —— 闭环驱动(driveCursor):逐键发 + 读屏验证;连发 chunk 会被 TUI
    //    合并丢键,高亮没到位就回车 = 选错模型(「选择卡死/选错」的根因之一)。
    //    卡住(键不生效/屏冻结)→ 重连取全量重绘再驱动一轮。
    if (curNum() != null && pickModelNum.value !== curNum()) {
      let drove = await driveCursor(pickModelNum.value)
      if (drove === 'stuck') {
        props.reconnectAll()
        await sleep(1500)
        drove = await driveCursor(pickModelNum.value)
      }
      if (drove !== 'ok') {
        submitErr.value = drove === 'gone' ? '菜单已关闭,请重新打开' : '高亮驱动不动,请点「强制刷新」重试'
        return
      }
      await sleep(300) // 等 effort 行随模型刷新
    }
    // 2) 力度:目标档若与现档不同则调。先按环序算最短方向发一批,再 cycle-until-match 纠偏
    //    (最多补满一圈)。该模型不支持力度(effort 行消失)则跳过。
    const target = pickEffort.value
    if (target && normEffort(selView.value?.effort)) {
      const fromI = EFFORT_RING.indexOf(normEffort(selView.value?.effort))
      const toI = EFFORT_RING.indexOf(target)
      if (fromI >= 0 && toI >= 0 && fromI !== toI) {
        const left = (toI - fromI + 6) % 6
        const right = (fromI - toI + 6) % 6
        const seq = left <= right ? '\x1b[D'.repeat(left) : '\x1b[C'.repeat(right)
        await selRaw(seq)
        await sleep(380)
      }
      for (let i = 0; i < 6; i++) {
        const live = normEffort(selView.value?.effort)
        if (!live || live.toLowerCase() === target.toLowerCase()) break
        await selRaw('\x1b[D')
        await sleep(380)
      }
    }
    // 3) 确认 + 收尾。回车后可能异步弹「Switch model? ❯1.Yes 2.No」二级确认(仅当对话有缓存、
    //    切到别的模型时;窄屏下可能晚几百 ms 才出)。固定 sleep 单查一次会漏 → 改轮询:
    //    直到菜单关闭(落定)或超时;期间每见到「Yes/No 确认页」就把 ❯ 落到 Yes 再回车。
    await selRaw('\r')
    let confirms = 0
    let reEnters = 0
    for (let i = 0; i < 18; i++) {
      await sleep(300)
      if (props.state.status !== 'select') break // 菜单已关 = 落定
      const opts = props.state.select?.options || []
      const yes = opts.find((o) => /yes|switch to|继续|确认/i.test(o.text))
      const isConfirm = !!yes || opts.some((o) => /no, go back|返回|取消/i.test(o.text))
      if (isConfirm && confirms < 3) {
        // 二级「Switch model?」确认页:闭环把 ❯ 落到 Yes 再回车。
        if (yes) await driveCursor(yes.num)
        await selRaw('\r')
        confirms++
      } else if (!isConfirm && i >= 2 && reEnters < 2) {
        // 还停在模型菜单(非确认页)= 第一次回车被重绘吞了 → 补发一次。
        await selRaw('\r')
        reEnters++
      }
    }
    // 4) 校验:菜单应已关闭。仍 select = 没自动落定(罕见)→ 提示;此时面板会渲染该确认页,可手点。
    if (props.state.status === 'select') {
      submitErr.value = '若仍停在确认页,点下方 Yes 即可'
    } else {
      props.reconnectAll() // 刷新一拍,顺带让 /sessions 的 model 回灌
    }
  } catch (e) {
    submitErr.value = '提交失败:' + (e instanceof Error ? e.message : String(e))
  } finally {
    submitting.value = false
  }
}
// pickOption — 点选项 = ↑/↓ 走到该项 + Enter 确认。
// 不再发数字:数字直达只在部分菜单(如权限询问)有效,/model 这类菜单按数字根本不选中
// (实测「无法选择」的根因);方向键 + Enter 在所有 claude 编号菜单上语义一致,普适且确定。
// 方向键与回车分两拍发:同一 chunk 连发时,回车可能落进高亮重渲窗口被吞。
async function pickOption(num: number): Promise<void> {
  if (selBusy.value) return // 防连点:上一次点选还在闭环驱动中
  selBusy.value = true
  try {
    const optsSig = () => JSON.stringify(props.state.select?.options ?? null)
    for (let attempt = 0; attempt < 2; attempt++) {
      if (curNum() == null) {
        void selRaw(String(num)) // 兜底:没解析到 ❯ 当前项,退回数字直达
        break
      }
      const drove = await driveCursor(num)
      if (drove === 'gone') break // 菜单已消失(别盲发回车,可能敲进聊天框)
      if (drove === 'stuck' && attempt === 0) {
        // 卡死主因:半开假活(键没到设备)或屏冻结(键到了但回灌不来)→ 重连取全量重绘后整轮重试。
        props.reconnectAll()
        await sleep(1500)
        continue
      }
      const before = optsSig()
      await sleep(150) // 方向键与回车分两拍:同 chunk 连发时回车会落进高亮重渲窗口被吞
      await selRaw('\r')
      // 验证回车生效:菜单关闭(status 离开 select)或换页(选项集变了 = 二级确认页)。
      for (let i = 0; i < 6; i++) {
        await sleep(250)
        if (props.state.status !== 'select' || optsSig() !== before) break
        if (i === 3) await selRaw('\r') // 1s 没动静:回车可能被重绘吞了 → 补发一次
      }
      break
    }
  } finally {
    // 确认后可能弹「follow-on」二级确认菜单,半开假活时读不到 → 强制重连取全量重绘
    // (菜单已关回 idle 时只是一次无害刷新)。
    setTimeout(() => props.reconnectAll(), 500)
    selBusy.value = false
  }
}
function autogrow() {
  const e = ta.value
  if (!e) return
  e.style.height = 'auto'
  e.style.height = Math.min(e.scrollHeight, 220) + 'px'
}
async function submit() {
  const t = text.value.trim()
  const hasImgs = atts.items.value.length > 0
  if ((!t && !hasImgs) || !canSend.value || apiBusy.value || modelBusy.value) return

  // 带图:HTTP /sendkeys 原子提交(设备端 clear → 打字 → 逐张括号粘贴 → 等图吃进 → Enter,
  // 自带 server floor:非输入态 409 拒发)。纯发图(无文本)同样成立。
  if (hasImgs) {
    if (atts.uploading.value) return // 上传未完不发(按钮同步禁用)
    if (atts.failed.value) {
      apiErr.value = '有图片上传失败,移除后再发送' // 决不静默丢图发出去
      return
    }
    apiBusy.value = true
    apiErr.value = ''
    try {
      const r = await fetch(sendkeysUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          session: tmuxName(props.sid),
          text: t,
          images: atts.paths.value,
          clear: true,
          enter: true,
        }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; kind?: string }
      if (r.ok && j.ok) {
        text.value = ''
        atts.clear()
        autogrow()
      } else if (j.kind === 'stale') {
        apiErr.value = '会话已被取代,请回列表重进'
      } else if (r.status === 409) {
        apiErr.value = '当前不是输入态,稍后再试'
      } else if (j.kind === 'input') {
        apiErr.value = '图片未注入成功,请重试' // 设备端一张都没粘进(containment 全拒等)
      } else {
        apiErr.value = '发送失败 (' + r.status + ')'
      }
    } catch {
      apiErr.value = '发送失败:网络错误'
    } finally {
      apiBusy.value = false
    }
    return
  }

  // 纯文本:维持 /term WS 的确认式管线(clear→type→submit,jsonl 权威确认)。
  await props.ensureLive?.() // 发送前确保 WS 真活(移动端后台回来可能已死)
  const ok = await sendText(text.value)
  if (ok) {
    text.value = ''
    autogrow()
  }
}
function onKey(e: KeyboardEvent) {
  if (e.isComposing || e.shiftKey) return
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}
function stop() {
  if (busy.value)
    interrupt() // 确认式发送中 → 打断本地流程
  else raw('\x1b') // claude 生成中 → 发 Esc 打断
}
// busy 态窄条:对齐 TUI 的「✻ 动作… (耗时)」。文案优先当前 in_progress 任务的 activeForm;
// 耗时由 busyMeta 用浏览器钟现算(见下)。不再显示 ↑token —— jsonl 的 output_tokens 仅每条 assistant
// 落盘后才累加,流式生成中必滞后于 TUI 实时计数 → 必然"对不上";只保留一个能保证准的墙钟耗时。
const current = computed(() => props.state.tasks.find((t) => t.status === 'in_progress') ?? null)
const busyLabel = computed(() => {
  if (busy.value || apiBusy.value) return '发送中…'
  if (current.value?.activeForm) return current.value.activeForm + '…'
  return st.value === 'awaiting-tool' ? '执行工具中…' : '生成中…'
})
// 秒针:busy/断联/压缩时每秒 tick,驱动「回合耗时」现算、断联升级、以及压缩进度条爬升。
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  if (isBusy.value) busyStartMs.value = Date.now() // 进来时已在忙:此刻起算(没观测到跳变的兜底)
  tick = setInterval(() => {
    if (isBusy.value || linkDown.value || compactPhase.value === 'running') now.value = Date.now()
  }, 1000)
})
onUnmounted(() => clearInterval(tick))
// 回合耗时:以「浏览器观测到转忙的时刻」(busyStartMs)起算 —— 纯浏览器墙钟,杜绝时钟偏移。
// 旧实现 now(浏览器) − turnStartedAt(设备落盘的 ISO)混两套钟:设备/浏览器钟差多少,每次读数就偏多少
// = 之前"时间对不上"的根因。仅当没观测到「闲→忙」跳变(如进来时已在忙)才退回设备 startedAt 兜底
// (可能带偏移,best-effort)。
const busyMeta = computed(() => {
  let base = busyStartMs.value
  if (!base && props.state.turnStartedAt) {
    const d = Date.parse(props.state.turnStartedAt)
    if (!Number.isNaN(d)) base = d
  }
  if (!base || now.value <= base) return ''
  return fmtDur((now.value - base) / 1000)
})
// 压缩进度行:真·百分比(读屏,来自屏上原生进度条 → 跟你 tmux 里看到的 NN% 一致)+ 墙钟耗时
// (compactStartMs 与 now 同源 Date.now(),无时钟偏移;完成后 now 停 tick → 冻结终值)。
const compactMeta = computed(() => {
  const parts: string[] = []
  if (compactPhase.value === 'running' && realPct.value != null) parts.push(realPct.value + '%')
  if (compactStartMs.value && now.value > compactStartMs.value)
    parts.push(fmtDur((now.value - compactStartMs.value) / 1000))
  return parts.join(' · ')
})

// 任务列表(类 TUI):进行中置顶、待办按序;最近完成的 1 条划线展示,更早的折成 +N。
const tasksOpen = ref(true)
const taskView = computed(() => {
  const ts = props.state.tasks
  const open = [
    ...ts.filter((t) => t.status === 'in_progress'),
    ...ts.filter((t) => t.status === 'pending'),
  ]
  const done = ts.filter((t) => t.status === 'completed')
  return {
    open,
    lastDone: done.length ? done[done.length - 1] : null,
    moreDone: Math.max(0, done.length - 1),
    done: done.length,
    total: ts.length,
  }
})
</script>

<template>
  <div class="composer">
    <!-- 断联:终端/事件流任一断 → 重连条整体替换输入框,禁止操作(状态不可靠)。 -->
    <div v-if="linkDown" class="linkbar" :class="{ down: downLong }">
      <template v-if="!downLong">
        <span class="bspin" />
        <span class="blbl">连接中…</span>
      </template>
      <template v-else>
        <span class="ldot" />
        <span class="blbl">{{ downWhat }}已断开,状态不可靠 — 已暂停操作</span>
        <span class="bsp" />
        <button class="lretry" :disabled="retrying" @click="retry">
          {{ retrying ? '重连中…' : '重连' }}
        </button>
      </template>
    </div>

    <!-- 压缩进度:专用进度卡(优先于通用 busy 卡)。进度条吃**读屏的真·百分比**(屏上原生「Compacting… NN%」)
         + 墙钟耗时 + 取消;完成补满转绿闪「已压缩」。读到真值前的头一两帧才退回不定式扫光过渡。 -->
    <div v-else-if="compactPhase !== 'idle'" class="cmpwrap">
      <div class="cmphead">
        <span class="cmpico">{{ compactPhase === 'done' ? '✓' : '🗜' }}</span>
        <span class="cmptitle">{{
          compactPhase === 'done' ? '已压缩 · 上下文已释放' : '正在压缩对话…'
        }}</span>
        <span class="bsp" />
        <span v-if="compactMeta" class="bmeta">{{ compactMeta }}</span>
        <button
          v-if="compactPhase === 'running' && !termless"
          class="bcancel"
          title="取消(Esc)"
          @click="cancelCompact"
        >
          取消
        </button>
      </div>
      <!-- done → 满格绿;读到真·百分比 → 真填充(width=屏上 NN%);还没读到(刚发命令) → 不定式扫光过渡。 -->
      <div class="cmpbar">
        <div v-if="compactPhase === 'done'" class="cmpfull" />
        <div v-else-if="realPct != null" class="cmpfillreal" :style="{ width: realPct + '%' }" />
        <div v-else class="cmpsweep" />
      </div>
    </div>

    <!-- /usage 用量面板:读屏解析的统计行;含百分比的行画小进度条。
         ⚠️ 必须排在 isBusy 之前:usage 浮层开着时读屏可能误判成「生成中」,否则 busy 卡会顶掉本面板
         (CDP 实测的卡死根因)。 -->
    <div v-else-if="usageOpen" class="selectwrap">
      <div class="selhd">用量统计</div>
      <div v-if="usageLoading" class="usgload"><span class="bspin" /> 正在读取用量面板…</div>
      <template v-else-if="usageLines.length">
        <div v-if="usageTabs.length > 1" class="usgtabs">
          <button
            v-for="t in usageTabs"
            :key="t"
            class="usgtab"
            :class="{ on: t === usageTab }"
            @click="usageTab = t"
          >
            {{ t }}
          </button>
        </div>
        <ul class="usglist">
          <li v-for="(l, i) in usageView" :key="i" class="usgrow">
            <span class="usgtext">{{ l.text }}</span>
            <span v-if="l.pct != null" class="usgbar">
              <span class="usgfill" :style="{ width: l.pct + '%' }" />
            </span>
          </li>
        </ul>
      </template>
      <p v-if="usageErr" class="selerr">{{ usageErr }}</p>
      <div class="selfoot">
        <button class="selk" @click="closeUsage">关闭</button>
        <button class="selk" :disabled="usageLoading" @click="openUsage">刷新</button>
      </div>
    </div>

    <!-- /config 设置面板(只读):同 usage,必须排在 isBusy 之前(浮层开着时读屏可能误判忙)。 -->
    <div v-else-if="cfgOpen" class="selectwrap">
      <div class="selhd">设置总览<span class="cfgro">只读 · 改设置请在终端 /config</span></div>
      <div v-if="cfgLoading" class="usgload"><span class="bspin" /> 正在读取设置面板…</div>
      <ul v-else-if="cfgRows.length" class="cfglist">
        <li v-for="row in cfgRows" :key="row.label" class="cfgrow">
          <span class="cfglb">{{ row.label }}</span>
          <span v-if="row.flag" class="cfgflag" :class="row.flag">{{ row.value }}</span>
          <span v-else class="cfgval">{{ row.value }}</span>
        </li>
      </ul>
      <p v-if="cfgErr" class="selerr">{{ cfgErr }}</p>
      <div class="selfoot">
        <button class="selk" @click="closeConfig">关闭</button>
        <button class="selk" :disabled="cfgLoading" @click="openConfig">刷新</button>
      </div>
    </div>

    <!-- /status 状态面板(只读,同样须排在 isBusy 之前) -->
    <div v-else-if="stOpen" class="selectwrap">
      <div class="selhd">状态总览</div>
      <div v-if="stLoading" class="usgload"><span class="bspin" /> 正在读取状态面板…</div>
      <ul v-else-if="stRows.length" class="cfglist stfull">
        <li v-for="row in stRows" :key="row.label" class="cfgrow">
          <span class="cfglb">{{ row.label }}</span>
          <span class="cfgval">{{ row.value }}</span>
        </li>
      </ul>
      <p v-if="stErr" class="selerr">{{ stErr }}</p>
      <div class="selfoot">
        <button class="selk" @click="closeStatus">关闭</button>
        <button class="selk" :disabled="stLoading" @click="openStatus">刷新</button>
      </div>
    </div>

    <!-- /stats 活跃统计面板(只读):热力图/图表 <pre> 原样 + 统计 KV -->
    <div v-else-if="statsOpen" class="selectwrap statswrap">
      <div class="selhd">活跃统计</div>
      <div v-if="statsLoading" class="usgload"><span class="bspin" /> 正在读取统计面板…</div>
      <template v-else>
        <pre v-if="statsHeat" class="statsart">{{ statsHeat }}</pre>
        <ul v-if="statsRows.length" class="cfglist">
          <li v-for="row in statsRows" :key="row.label" class="cfgrow">
            <span class="cfglb">{{ row.label }}</span>
            <span class="cfgval">{{ row.value }}</span>
          </li>
        </ul>
        <pre v-if="statsChart" class="statsart">{{ statsChart }}</pre>
      </template>
      <p v-if="statsErr" class="selerr">{{ statsErr }}</p>
      <div class="selfoot">
        <button class="selk" @click="closeStats">关闭</button>
        <button class="selk" :disabled="statsLoading" @click="openStats">刷新</button>
      </div>
    </div>

    <!-- busy:收起输入框,换成底部状态卡(类 TUI:任务列表 + 转圈 + 动作 + 耗时/↑token + 取消)。 -->
    <div v-else-if="isBusy" class="busywrap">
      <div v-if="state.tasks.length" class="tasks">
        <button class="thead" @click="tasksOpen = !tasksOpen">
          <span class="tchev">{{ tasksOpen ? '▾' : '▸' }}</span>
          任务 {{ taskView.done }}/{{ taskView.total }}
        </button>
        <ul v-if="tasksOpen" class="tlist">
          <li v-for="(t, i) in taskView.open" :key="t.id ?? 'o' + i" :class="'t-' + t.status">
            <i class="tbox">{{ t.status === 'in_progress' ? '■' : '□' }}</i>
            <span class="tsubj">{{ t.subject }}</span>
          </li>
          <li v-if="taskView.lastDone" class="t-completed">
            <i class="tbox">✓</i>
            <s class="tsubj">{{ taskView.lastDone.subject }}</s>
          </li>
          <li v-if="taskView.moreDone" class="t-more">… +{{ taskView.moreDone }} 已完成</li>
        </ul>
      </div>
      <div class="busybar">
        <span class="bspin" />
        <span class="blbl">{{ busyLabel }}</span>
        <span v-if="busyMeta" class="bmeta">({{ busyMeta }})</span>
        <span class="bsp" />
        <!-- termless:Esc 发不进去(无 pane),不给假按钮 -->
        <button v-if="!termless" class="bcancel" title="取消(Esc)" @click="stop">取消</button>
      </div>
    </div>

    <!-- 只读:会话不在 tmux 中(无 pane 可控)。可「接管」:杀掉既有进程 → 在 tmux 里重建(防双写)。 -->
    <div v-else-if="termless" class="linkbar ro">
      <template v-if="takingOver">
        <span class="bspin" />
        <span class="blbl">接管中…(结束旧进程 → 在 tmux 中重建)</span>
      </template>
      <template v-else>
        <span class="ldot gray" />
        <span class="blbl">
          {{ takeErr ? '接管失败:' + takeErr : '该会话不在 tmux 中运行,无法远程控制 — 只读' }}
        </span>
        <span class="bsp" />
        <button class="lretry" @click="takeArmed = true">接管此会话</button>
        <!-- 确认改走 ConfirmDialog 弹窗:行内「提示文案+双按钮」在手机上会把条挤出屏幕 -->
        <ConfirmDialog
          v-if="takeArmed"
          title="接管此会话"
          message="将结束本机正在运行它的 claude 进程,并在 tmux 中重建(防双写)。确定接管?"
          confirm-label="确认接管"
          @confirm="doTakeover"
          @cancel="takeArmed = false"
        />
      </template>
    </div>

    <!-- select:claude 在等待选择。 -->
    <div v-else-if="isSelect" class="selectwrap">
      <!-- 模型菜单 = 单面板:模型列表(本地单选)+ 力度滑块(本地选)→ 确认一次性提交并校验。 -->
      <template v-if="isModelMenu">
        <div class="selhd">选择模型与力度</div>
        <ul class="sellist">
          <li
            v-for="o in selView!.options"
            :key="o.num"
            class="selrow"
            :class="{ sel: o.num === pickModelNum }"
            @click="chooseModel(o.num)"
          >
            <i class="selradio" />
            <span class="selname">{{ optName(o.text) }}</span>
            <span v-if="optDesc(o.text)" class="seldesc">{{ optDesc(o.text) }}</span>
          </li>
        </ul>
        <!-- 力度滑块:一排档位点,当前=白色大圆,最高档(Ultracode)紫色 accent。点选即本地切换。 -->
        <div class="effwrap">
          <div class="efflabel">
            <span>力度</span><span class="effcur">{{ pickEffort || '不支持' }}</span>
          </div>
          <div class="effslider">
            <button
              v-for="lv in EFFORT_DISPLAY"
              :key="lv"
              class="effdot"
              :class="{ knob: lv === pickEffort }"
              :title="lv"
              @click="chooseEffort(lv)"
            />
          </div>
        </div>
        <p v-if="submitErr" class="selerr">{{ submitErr }}</p>
        <div class="selfoot">
          <button class="selk" :disabled="submitting" @click="cancelSelection">取消</button>
          <button class="selk" :disabled="submitting" title="没反应时强制重连刷新" @click="reconnectAll()">
            强制刷新
          </button>
          <button
            class="selk primary"
            :disabled="submitting || pickModelNum == null"
            @click="submitModel"
          >
            {{ submitting ? '提交中…' : '确认' }}
          </button>
        </div>
      </template>

      <!-- 其它 select(信任目录 / 恢复 / 是否切换 等):简洁单选,点选即确认(闭环驱动 + 在途锁)。 -->
      <template v-else>
        <div class="selhd">
          {{ selView?.title || 'Claude 正在等待选择' }}
          <span v-if="selBusy" class="selspin"><i class="bspin" /></span>
        </div>
        <ul class="sellist" :class="{ busy: selBusy }">
          <li
            v-for="o in selView?.options || []"
            :key="o.num"
            class="selrow"
            :class="{ cur: o.current }"
            @click="pickOption(o.num)"
          >
            <span class="selname">{{ optName(o.text) }}</span>
            <span v-if="optDesc(o.text)" class="seldesc">{{ optDesc(o.text) }}</span>
          </li>
        </ul>
        <div class="selfoot">
          <button class="selk" :disabled="selBusy" @click="cancelSelection">取消</button>
          <!-- 自救:屏冻结/键不生效时强制重连终端取全量重绘(选择卡死的逃生口) -->
          <button class="selk" title="点选没反应时:强制重连终端刷新真实状态" @click="reconnectAll()">
            强制刷新
          </button>
        </div>
      </template>
    </div>

    <!-- 压缩对话(/compact):可选聚焦指令 → 原生 /sendkeys 执行,随后进「Compacting…」忙态。 -->
    <div v-else-if="compactOpen" class="selectwrap">
      <div class="selhd">压缩对话</div>
      <p class="cmpdesc">总结目前的对话、释放上下文。可选:指定压缩时重点保留什么。</p>
      <textarea
        v-model="compactInstr"
        class="cmpinput"
        rows="2"
        placeholder="可选:聚焦保留什么(留空 = 默认压缩)"
        :disabled="compacting"
      />
      <p v-if="compactErr" class="selerr">{{ compactErr }}</p>
      <div class="selfoot">
        <button class="selk" :disabled="compacting" @click="closeCompact">取消</button>
        <button class="selk primary" :disabled="compacting" @click="runCompact">
          {{ compacting ? '压缩中…' : '压缩' }}
        </button>
      </div>
    </div>

    <!-- 斜杠命令面板:全量内置命令分页展示;颜色区分「网页有渲染」(紫)与「仅终端可见」(灰)。 -->
    <div v-else-if="slashOpen" class="selectwrap">
      <div class="selhd slashhd">
        <span>斜杠命令</span>
        <span class="sllegend"
          ><i class="lgdot on" />有控件 <i class="lgdot off" />无 <i class="lgdot dg" />需确认</span
        >
      </div>
      <input
        v-model="slashQuery"
        class="slashfilter"
        type="text"
        placeholder="筛选命令…(支持中英文模糊匹配,如 ctx / 切模)"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
      />
      <div v-if="!slashFiltered.length" class="slashnone">(无匹配命令)</div>
      <ul class="sellist slashlist">
        <li
          v-for="p in slashView"
          :key="p.cmd"
          class="selrow slashrow"
          @click="runSlash(p)"
        >
          <code class="slashcmd" :class="{ danger: !!p.confirm, term: !p.render && !p.confirm }">{{
            p.cmd
          }}</code>
          <span class="seldesc">{{ p.desc }}</span>
          <span v-if="slashBusy === p.cmd" class="slashspin"><i class="bspin" /></span>
        </li>
      </ul>
      <p v-if="slashErr" class="selerr">{{ slashErr }}</p>
      <div v-if="slashPages > 1" class="slpager">
        <button class="pgk" :disabled="slashPage === 0" @click="slashPage--">‹</button>
        <span class="pgno">{{ slashPage + 1 }} / {{ slashPages }}</span>
        <button class="pgk" :disabled="slashPage >= slashPages - 1" @click="slashPage++">›</button>
      </div>
      <div class="selfoot">
        <button class="selk" @click="closeSlash">取消</button>
        <button class="selk" @click="manualSlash">手动输入…</button>
      </div>
      <!-- 危险命令确认弹窗(取代旧的「点两次确认」) -->
      <ConfirmDialog
        v-if="slashConfirm"
        :title="'执行 ' + slashConfirm.cmd"
        :message="slashConfirm.confirm || ''"
        :busy="!!slashBusy"
        confirm-label="确认执行"
        @confirm="confirmSlash"
        @cancel="slashConfirm = null"
      />
    </div>

    <!-- idle:正常输入框。拖图进框即附;textarea 粘图即附。 -->
    <template v-else>
      <div class="box" @dragover.prevent @drop.prevent="onDrop">
        <!-- 附件条:缩略图 + 上传态(转圈/红框)+ ✕ 移除。 -->
        <div v-if="atts.items.value.length" class="atts">
          <span
            v-for="a in atts.items.value"
            :key="a.id"
            class="att"
            :class="{ err: a.status === 'error' }"
            :title="a.status === 'error' ? a.name + ':' + a.error : a.name"
          >
            <img :src="a.preview" alt="" />
            <span v-if="a.status === 'uploading'" class="up"><i class="bspin" /></span>
            <span v-else-if="a.status === 'error'" class="up errmark">!</span>
            <button class="rm" title="移除" @click="atts.remove(a.id)">✕</button>
          </span>
        </div>
        <textarea
          ref="ta"
          v-model="text"
          rows="1"
          placeholder="给 Claude 发消息…  (Enter 发送 · Shift+Enter 换行 · 可粘贴/拖拽图片)"
          @input="autogrow"
          @keydown="onKey"
          @paste="onPaste"
        />
        <div class="bar">
          <span class="left">
            <button class="ic" title="斜杠命令" @click="openSlash">/</button>
            <button class="ic" title="附图(也可粘贴/拖拽)" @click="pickFiles">🖼</button>
            <input ref="fileEl" type="file" accept="image/*" multiple hidden @change="onFiles" />
            <!-- 状态/权限聚合在这里(顶栏只留连接 icon):中文短标签,原值放 title。 -->
            <span class="stchip" :class="'st-' + st" :title="'界面态: ' + st">
              <i class="stdot" />{{ fmtStatus(st) }}
            </span>
            <span v-if="state.permissionMode" class="pm" :title="state.permissionMode">{{
              fmtPermMode(state.permissionMode)
            }}</span>
          </span>
          <span class="right">
            <span v-if="apiErr" class="ph err">{{ apiErr }}</span>
            <span v-else-if="phase === 'error'" class="ph err">{{ error }}</span>
            <button
              class="send"
              :disabled="
                !canSend ||
                (!text.trim() && !atts.items.value.length) ||
                atts.uploading.value ||
                apiBusy ||
                modelBusy
              "
              :title="atts.uploading.value ? '图片上传中…' : '发送'"
              @click="submit"
            >
              ↑
            </button>
          </span>
        </div>
      </div>
      <div v-if="!canSend" class="warn">
        当前界面态:{{ fmtStatus(st) }}(非输入态,暂不可发)
        <button v-if="overlayUp" class="wesc" @click="raw('\x1b')">Esc 关闭面板</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.composer {
  flex: none;
}
/* 断联重连条:同卡片观感;刚断的前几秒按「连接中…」(转圈),超时升级成警示(红点 + 重连按钮)。 */
.linkbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #2a2a2acc;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
}
.linkbar.down {
  border-color: #5a3a3a;
}
.ldot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--red);
}
.ldot.gray {
  background: var(--mut);
}
.linkbar.ro .blbl {
  color: var(--mut);
}
.lretry.danger {
  border-color: #5a3a3a;
  background: #3a2626;
  color: #ff9b94;
}
/* select 面板:标题 + 可点选项(当前项高亮)+ 方向键行。同卡片观感。 */
.selectwrap {
  /* PC 大屏收窄居中:浮层容器最宽 760,这里把选单卡限到 ~420 居中,不占满一整行显得突兀。 */
  max-width: 420px;
  margin: 0 auto;
  background: #2a2a2acc;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  padding: 10px 12px;
  overflow: hidden;
}
/* 两步选单:标题 + 列表/力度 + 底部按钮。简洁,留白克制。 */
.selhd {
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
  padding: 2px 2px 10px;
}
.sellist {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 264px;
  overflow-y: auto;
}
.selrow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  color: var(--fg);
  font-size: 12.5px;
  cursor: pointer;
}
.selrow:hover {
  background: var(--vsc-list-hover);
}
/* 本地单选高亮 + 填充 radio */
.selrow.sel {
  background: #ffffff10;
}
.selradio {
  flex: none;
  align-self: center;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--mut);
}
.selrow.sel .selradio {
  border-color: var(--acc);
  background: radial-gradient(circle, var(--acc) 0 3px, transparent 3.5px);
}
.selname {
  flex: none;
  font-weight: 600;
}
.seldesc {
  flex: 1;
  min-width: 0;
  color: var(--mut);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 力度滑块:一排档位点。每个点是 30px 大热区(好点),里面画 10px 小圆点;当前档=白色大圆(knob)。
   档位点统一灰色(去掉之前末档的蓝色「异色小方块」,显突兀)。 */
.effwrap {
  padding: 2px 2px 6px;
}
.efflabel {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  color: var(--mut);
  margin-bottom: 8px;
}
.effcur {
  color: var(--fg);
  font-weight: 600;
  font-size: 13px;
}
.effslider {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
}
.effslider::before {
  content: '';
  position: absolute;
  left: 15px; /* = 热区半宽,使横线穿过各点圆心 */
  right: 15px;
  top: 50%;
  height: 2px;
  background: #3a3a3a;
  transform: translateY(-50%);
}
.effdot {
  position: relative;
  z-index: 1;
  width: 30px; /* 大热区 */
  height: 30px;
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.effdot::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #6a6a6a;
}
.effdot:hover::before {
  background: #9a9a9a;
}
.effdot.knob::before {
  width: 20px;
  height: 20px;
  background: #fff;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.6);
}
/* select 在途锁:闭环驱动期间列表禁点防连点,标题旁转圈给反馈 */
.selspin {
  display: inline-flex;
  vertical-align: -2px;
  margin-left: 8px;
}
.sellist.busy {
  pointer-events: none;
  opacity: 0.6;
}
.selerr {
  color: #e66;
  font-size: 12px;
  margin: 0 2px 8px;
}
/* /compact 面板:说明 + 可选聚焦指令输入 */
.cmpdesc {
  color: var(--mut);
  font-size: 12px;
  line-height: 1.5;
  margin: 0 2px 10px;
}
.cmpinput {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  background: #1a1a1a;
  border: 1px solid var(--vsc-input-border);
  border-radius: 8px;
  color: var(--fg);
  font: 13px/1.5 var(--vsc-sans);
  padding: 8px 10px;
  margin-bottom: 10px;
  outline: none;
}
.cmpinput:focus {
  border-color: var(--acc);
}
.cmpinput::placeholder {
  color: #6e6e6e;
}
/* 斜杠命令面板:命令名(mono 小章)+ 描述;危险命令(/clear)二次确认时整行转警示色。 */
.slashrow {
  align-items: center;
}
.slashrow .seldesc {
  white-space: normal; /* 确认提示可换行,不被省略号截断 */
}
.slashcmd {
  flex: none;
  font-family: var(--vsc-mono);
  font-size: 12.5px;
  color: var(--acc);
  background: #ffffff0d;
  padding: 1px 7px;
  border-radius: 6px;
}
.slashcmd.danger {
  color: #ff9b94;
}
/* 无渲染(结果只在设备终端的 TUI 浮层/本地效果)→ 灰章;有渲染保持 acc 色。 */
.slashcmd.term {
  color: #8f8f8f;
}
/* /usage 用量面板:读屏统计行 + 小进度条 */
/* /usage 分组 tab(手机端全量太长):小胶囊,当前页高亮。 */
.usgtabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.usgtab {
  flex: none;
  font-size: 12px;
  padding: 4px 14px;
  border-radius: 999px;
  border: 1px solid var(--vsc-input-border);
  background: transparent;
  color: var(--mut);
  cursor: pointer;
}
.usgtab.on {
  background: var(--vsc-btn-bg);
  border-color: transparent;
  color: #fff;
}
.usgload {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mut);
  font-size: 12px;
  padding: 10px 2px 14px;
}
.usglist {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px; /* 不限高不滚动:全文展开(内容有限,卡片随之长高) */
}
.usgrow {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.usgtext {
  color: var(--fg);
  font-size: 12px;
  font-family: var(--vsc-mono);
  word-break: break-word;
}
.usgbar {
  height: 5px;
  border-radius: 999px;
  background: #ffffff14;
  overflow: hidden;
}
.usgfill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--acc), #9d8bff);
}
/* /config 设置面板:label-value 行,true/false 渲染成开关章;不限高不滚动。 */
.cfgro {
  margin-left: 8px;
  font-size: 10.5px;
  font-weight: 400;
  color: var(--mut);
}
.cfglist {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cfgrow {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.cfglb {
  flex: 1;
  min-width: 0;
  color: var(--fg);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfgval {
  flex: none;
  font-family: var(--vsc-mono);
  font-size: 11.5px;
  color: var(--mut);
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfgflag {
  flex: none;
  font-size: 10.5px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid;
}
.cfgflag.on {
  color: #2ea043;
  border-color: #2ea04355;
  background: #2ea04314;
}
.cfgflag.off {
  color: #8f8f8f;
  border-color: #3a3a3a;
  background: #ffffff08;
}
/* /status:值不省略 —— 标签定宽、值占满剩余宽度并允许换行(会话 ID/路径/组织名都很长)。 */
.stfull .cfglb {
  flex: none;
}
.stfull .cfgval {
  flex: 1;
  min-width: 0;
  max-width: none;
  white-space: normal;
  word-break: break-all;
  text-align: right;
}
/* /stats:ASCII 热力图/图表原样渲染;卡片放宽以容纳图宽。 */
.statswrap {
  max-width: 560px;
}
.statsart {
  margin: 0 0 10px;
  padding: 8px 10px;
  background: #1a1a1a;
  border: 1px solid var(--bd, #2b2b2b);
  border-radius: 8px;
  font-family: var(--vsc-mono);
  /* 手机端按视口缩字号让 ~60 列 ASCII 图整体放下,不出横向滚动条;大屏封顶 10.5px */
  font-size: clamp(5.5px, 2.2vw, 10.5px);
  line-height: 1.35;
  color: #9d8bff;
  overflow: hidden;
  white-space: pre;
}
/* 过滤输入框:面板顶部,边框聚焦同 acc 色。 */
.slashfilter {
  width: 100%;
  box-sizing: border-box;
  background: #1a1a1a;
  border: 1px solid var(--vsc-input-border);
  border-radius: 8px;
  color: var(--fg);
  font: 12.5px/1.5 var(--vsc-sans);
  padding: 6px 10px;
  margin-bottom: 8px;
  outline: none;
}
.slashfilter:focus {
  border-color: var(--acc);
}
.slashfilter::placeholder {
  color: #6e6e6e;
}
.slashnone {
  color: var(--mut);
  font-size: 12px;
  text-align: center;
  padding: 14px 0;
}
/* 斜杠面板列表:已有分页,放开 select 菜单的限高/滚动(滚动条 + 分页并存很怪)。 */
.slashlist {
  max-height: none;
  overflow-y: visible;
}
.slashhd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sllegend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--mut);
}
.lgdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 8px;
}
.lgdot.on {
  background: var(--acc);
}
.lgdot.off {
  background: #8f8f8f;
}
.lgdot.dg {
  background: #ff9b94;
}
/* 分页条:‹ n/N › */
.slpager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 2px 0 8px;
}
.pgk {
  width: 44px;
  padding: 3px 0;
  border-radius: 8px;
  border: 1px solid var(--vsc-input-border);
  background: var(--vsc-btn2-bg);
  color: var(--fg);
  font-size: 15px;
  line-height: 1.2;
  cursor: pointer;
}
.pgk:hover:not(:disabled) {
  border-color: var(--acc);
}
.pgk:disabled {
  opacity: 0.35;
  cursor: default;
}
.pgno {
  font-size: 12px;
  color: var(--mut);
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.slashspin {
  flex: none;
  display: flex;
  align-items: center;
}
.selfoot {
  display: flex;
  gap: 8px;
}
.selk {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--vsc-input-border);
  background: var(--vsc-btn2-bg);
  color: var(--fg);
  cursor: pointer;
  font-size: 13px;
}
.selk:hover {
  border-color: var(--acc);
}
.selk.primary {
  background: var(--vsc-btn-bg);
  color: #fff;
  border-color: transparent;
}
.selk.primary:hover {
  background: var(--vsc-btn-hover);
}
.selk:disabled {
  opacity: 0.5;
  cursor: default;
}
.lretry {
  flex: none;
  font-size: 12px;
  padding: 5px 16px;
  border-radius: 8px;
  border: 1px solid var(--vsc-input-border);
  background: var(--vsc-btn2-bg);
  color: var(--fg);
  cursor: pointer;
}
.lretry:hover {
  border-color: var(--acc);
}
.lretry:disabled {
  opacity: 0.6;
  cursor: default;
}
/* busy 状态卡:浮动卡片(与 box 同底色),上半是任务列表(可折叠),下半是 转圈 + 动作 + 耗时/↑token + 取消。 */
.busywrap {
  background: #2a2a2acc;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.busybar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
/* 任务列表(类 TUI):■ 进行中 / □ 待办 / ✓ 最近完成划线 / +N 已完成折叠。 */
.tasks {
  padding: 8px 14px 0;
  border-bottom: 1px solid #3a3a3a;
}
.thead {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: none;
  padding: 0 0 6px;
  color: var(--mut);
  font-size: 11px;
  cursor: pointer;
}
.tchev {
  width: 10px;
}
.tlist {
  list-style: none;
  margin: 0;
  padding: 0 0 8px;
  max-height: 168px; /* 长列表滚动,别把浮动卡撑满屏 */
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.7;
}
.tlist li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--mut);
}
.tbox {
  flex: none;
  font-style: normal;
  font-family: var(--vsc-mono);
}
.tsubj {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-in_progress {
  color: var(--fg);
}
.t-in_progress .tbox {
  color: var(--amber);
}
.t-completed,
.t-completed .tsubj {
  color: #6e6e6e;
}
.t-completed .tbox {
  color: var(--green);
}
.t-more {
  color: #6e6e6e;
  font-size: 11px;
}
.bspin {
  flex: none;
  width: 13px;
  height: 13px;
  border: 2px solid var(--amber);
  border-top-color: transparent;
  border-radius: 50%;
  animation: cspin 0.7s linear infinite;
}
@keyframes cspin {
  to {
    transform: rotate(360deg);
  }
}
.blbl {
  color: var(--fg);
  font-size: 13px;
  min-width: 56px; /* 窄屏被 meta 挤压时至少留 ~4 字 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bmeta {
  flex: none;
  color: var(--mut);
  font-size: 11.5px;
  font-family: var(--vsc-mono);
  white-space: nowrap;
}
.bsp {
  flex: 1;
}
.bcancel {
  flex: none;
  font-size: 12px;
  padding: 5px 16px;
  border-radius: 8px;
  border: 1px solid #5a3a3a;
  background: #3a2626;
  color: #ff9b94;
  cursor: pointer;
}
.bcancel:hover {
  border-color: var(--red);
}
/* 压缩进度卡:标题行(图标 + 文案 + 耗时/↑token + 取消)+ 进度条。同卡片观感。 */
.cmpwrap {
  background: #2a2a2acc;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  padding: 12px 14px;
}
.cmphead {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 11px;
}
.cmpico {
  flex: none;
  font-size: 14px;
  line-height: 1;
}
.cmptitle {
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 进度条轨道。有真·百分比(读屏)→ .cmpfillreal 真填充;读到之前 → .cmpsweep 不定式扫光过渡;
   完成 → .cmpfull 整条补满、绿色、静止。 */
.cmpbar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: #ffffff14;
  overflow: hidden;
}
/* 真填充条:宽度 = 屏上读到的真百分比;width 过渡平滑掉每次轮询的跳变。 */
.cmpfillreal {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--acc), #9d8bff);
  transition: width 0.4s ease-out;
}
/* running 起步(还没读到真值):扫光带(宽 38%,从左滑到右,无限循环)。ease-in-out 让两端略缓,像在来回"扫"。 */
.cmpsweep {
  position: absolute;
  top: 0;
  height: 100%;
  width: 38%;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, var(--acc), #9d8bff, transparent);
  animation: cmpsweep 1.15s ease-in-out infinite;
}
@keyframes cmpsweep {
  0% {
    left: -42%;
  }
  100% {
    left: 100%;
  }
}
/* done:整条补满绿色、静止。 */
.cmpfull {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--green);
}
.box {
  background: #2a2a2acc;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  padding: 8px 10px 6px;
  box-shadow:
    0 8px 28px rgba(0, 0, 0, 0.5),
    0 1px 0 rgba(255, 255, 255, 0.03) inset;
}
.box:focus-within {
  border-color: var(--acc);
}
.box.disabled {
  opacity: 0.7;
}
/* 附件条:缩略图方块(上传中蒙层转圈;失败红框 + !,title 给原因)。 */
.atts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 2px 8px;
}
.att {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vsc-input-border);
  flex: none;
}
.att img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.att.err {
  border-color: var(--red);
}
.att .up {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.att .up.errmark {
  color: var(--red);
  font-weight: 700;
  font-size: 18px;
}
.att .rm {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 0;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
textarea {
  width: 100%;
  background: none;
  border: 0;
  color: var(--fg);
  resize: none;
  font: 13.5px/1.5 var(--vsc-sans);
  outline: none;
  max-height: 220px;
  display: block;
  padding: 2px 2px 0;
  scrollbar-width: none; /* Firefox:隐藏滚动条(超长时仍可滚) */
}
/* WebKit:隐藏输入框那条粗滚动条(盖过 .ccfly-chat 的全局 10px 滚动条样式) */
textarea::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
textarea::placeholder {
  color: #6e6e6e;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.left {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ic {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--vsc-input-border);
  background: none;
  color: var(--mut);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.ic:hover {
  background: var(--vsc-list-hover);
  color: var(--fg);
}
/* 宽版工具钮(文字标签,如「模型」):同 .ic 观感,宽度随内容。 */
.icw {
  height: 26px;
  padding: 0 9px;
  border-radius: 7px;
  border: 1px solid var(--vsc-input-border);
  background: none;
  color: var(--mut);
  cursor: pointer;
  font-size: 11.5px;
  line-height: 1;
  white-space: nowrap;
}
.icw:hover {
  background: var(--vsc-list-hover);
  color: var(--fg);
}
.icw:disabled {
  opacity: 0.5;
  cursor: default;
}
.pm {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--vsc-btn2-bg);
  color: var(--mut);
}
/* 状态小章:彩点 + 中文短标签(空闲绿/离线红/忙黄/其它灰)。 */
.stchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--mut);
  white-space: nowrap;
}
.stdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mut);
  flex: none;
}
.st-idle .stdot {
  background: var(--green);
}
.st-offline .stdot {
  background: var(--red);
}
.st-generating .stdot,
.st-awaiting-tool .stdot,
.st-select .stdot {
  background: var(--amber);
}
.ph {
  font-size: 11px;
  color: var(--mut);
}
.ph.err {
  color: var(--red);
}
.send {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 0;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vsc-btn-bg);
  color: #fff;
}
.send:hover {
  background: var(--vsc-btn-hover);
}
.send:disabled {
  opacity: 0.4;
  cursor: default;
}
.send.stop {
  background: #c4443a;
  font-size: 11px;
}
.warn {
  font-size: 11px;
  color: var(--mut);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wesc {
  flex: none;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 6px;
  border: 1px solid var(--vsc-input-border);
  background: var(--vsc-btn2-bg);
  color: var(--fg);
  cursor: pointer;
}
.wesc:hover {
  border-color: var(--acc);
}
</style>
