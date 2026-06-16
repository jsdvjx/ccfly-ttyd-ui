// 从 jsonl 事件判断的状态函数(优先用这些)。每个状态一个函数。
// 锚点用「事件 type + 字段」这种结构化特征,不依赖会滚出视口的屏幕文案。
import type { JEvent, Status } from '../types.ts'

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

// 从尾部找第一个满足谓词的事件(last-wins / 最近事件用)。
function findLast(events: JEvent[], pred: (e: JEvent) => boolean): JEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (pred(events[i])) return events[i]
  }
  return null
}

// 本地斜杠命令的回声行(/model、/clear、/context …):jsonl 里记成 **user** 事件且不带 isMeta,
// 但它们**永远不会有 assistant 回复**(命令在本地执行,结果走 <local-command-stdout>)。
// detectTurn 必须跳过它们 —— 否则会话尾巴停在 /model 这类命令上时,「user 没等到回复」被
// 误判成 generating **且永远不退**(实案:屏判失效时输入框卡死「生成中…」,计时器从命令
// 时刻起一路涨)。
// 同理 `!命令`(bash 模式)的回显 <bash-input>/<bash-stdout>/<bash-stderr> 也是无 assistant 回复的
// user 行 —— 一并跳过,否则尾部停在 bash 命令上同样会卡「生成中…」。
const RE_LOCAL_CMD =
  /<command-name>|<local-command-stdout>|<local-command-caveat>|<bash-input>|<bash-stdout>|<bash-stderr>/
function isLocalCmdEcho(e: JEvent): boolean {
  if (e.type !== 'user') return false
  const c = e.message?.content
  const s =
    typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? c
            .map((b) =>
              isObj(b) && (b as { type?: string }).type === 'text'
                ? ((b as { text?: string }).text ?? '')
                : '',
            )
            .join('')
        : ''
  return RE_LOCAL_CMD.test(s)
}

// detectTurn — 回合态。看尾部「最后一条非 meta、非本地命令回声的内容行」:
//   assistant 且收尾(end_turn/stop_sequence/max_tokens) → idle
//   assistant 且带未配对 tool_use → awaiting-tool(工具在飞)
//   user(真实 prompt 或 tool_result)→ generating(claude 还没回)
// ⚠️ 事件落盘后才可见:流式生成/工具执行进行时,尾部停在上一条,据此推断。
export function detectTurn(events: JEvent[]): Status {
  const last = findLast(
    events,
    (e) => (e.type === 'assistant' || e.type === 'user') && !e.isMeta && !isLocalCmdEcho(e),
  )
  if (!last) return 'idle'
  if (last.type === 'assistant') {
    const content = last.message?.content
    const blocks = Array.isArray(content) ? content : []
    const hasToolUse = blocks.some((b) => isObj(b) && b.type === 'tool_use')
    if (hasToolUse) return 'awaiting-tool'
    const sr = last.message?.stop_reason
    if (sr === 'end_turn' || sr === 'stop_sequence' || sr === 'max_tokens') return 'idle'
    return 'generating'
  }
  return 'generating'
}

// detectMode — 当前 mode(last-wins 快照)。
export function detectMode(events: JEvent[]): string | null {
  return findLast(events, (e) => e.type === 'mode')?.mode ?? null
}

// detectPermissionMode — 当前 permission-mode(default/acceptEdits/bypassPermissions/plan)。
export function detectPermissionMode(events: JEvent[]): string | null {
  return findLast(events, (e) => e.type === 'permission-mode')?.permissionMode ?? null
}

// detectTitle — 会话标题(last-wins ai-title)。
export function detectTitle(events: JEvent[]): string | null {
  return findLast(events, (e) => e.type === 'ai-title')?.aiTitle ?? null
}

// detectInterrupted — 最近一条真实 user 行是否带 interruptedMessageId(上回合被 Esc 打断)。
export function detectInterrupted(events: JEvent[]): boolean {
  return !!findLast(events, (e) => e.type === 'user' && !e.isMeta)?.interruptedMessageId
}

// detectApiError — 最近一条 assistant 若是 API 错误占位行 → 报错;否则 null(视为已恢复)。
export function detectApiError(events: JEvent[]): { status?: string; error?: string } | null {
  const last = findLast(events, (e) => e.type === 'assistant' && !e.isMeta)
  if (!last?.isApiErrorMessage) return null
  return {
    status: last.apiErrorStatus != null ? String(last.apiErrorStatus) : undefined,
    error: last.error,
  }
}

// detectPending — 当前挂着的后台 agent / 工作流数(取最近一条带计数的 system 行)。
export function detectPending(events: JEvent[]): { agents: number; workflows: number } {
  const e = findLast(
    events,
    (e) =>
      e.type === 'system' &&
      (typeof e.pendingBackgroundAgentCount === 'number' ||
        typeof e.pendingWorkflowCount === 'number'),
  )
  return {
    agents: e?.pendingBackgroundAgentCount ?? 0,
    workflows: e?.pendingWorkflowCount ?? 0,
  }
}

// detectLastActivity — 最近一条带 timestamp 的事件时间(最近活动)。
export function detectLastActivity(events: JEvent[]): string | null {
  return findLast(events, (e) => typeof e.timestamp === 'string')?.timestamp ?? null
}

// detectTurnMeta — 当前回合元数据,映射 TUI 忙碌行的「(18m 40s · ↑ 63.7k tokens)」:
//   startedAt    回合起点 = 最后一条**真实** user prompt(非 meta/非 sidechain/非 tool_result 回填)的 timestamp;
//                耗时由 UI 用 now - startedAt 现算(jsonl 落盘滞后,不在这里算死)。
//   outputTokens 起点之后主链 assistant 的 usage.output_tokens 累计(≈ TUI 的 ↑ 计数)。
export function detectTurnMeta(events: JEvent[]): {
  startedAt: string | null
  outputTokens: number
} {
  let start = -1
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'user' || e.isMeta || e.isSidechain) continue
    const c = e.message?.content
    if (Array.isArray(c) && c.some((b) => isObj(b) && b.type === 'tool_result')) continue
    start = i
    break
  }
  if (start < 0) return { startedAt: null, outputTokens: 0 }
  let tok = 0
  for (let i = start + 1; i < events.length; i++) {
    const e = events[i]
    if (e.type !== 'assistant' || e.isMeta || e.isSidechain) continue
    const t = e.message?.usage?.output_tokens
    if (typeof t === 'number') tok += t
  }
  const ts = events[start].timestamp
  return { startedAt: typeof ts === 'string' ? ts : null, outputTokens: tok }
}
