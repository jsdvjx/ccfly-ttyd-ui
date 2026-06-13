// 组合器:把各独立检测器拼成 SessionState。
//
// 顶层 status 走「屏判」为权威(idle/busy/select/各浮窗/offline 都从屏上认),
// 因为 jsonl 尾部会滞后(事件落盘后才可见,且「已提交未开始生成」判不准)。
// jsonl 只负责:busy 的子类型(awaiting-tool vs generating)+ 全部语义元数据
// (mode / permissionMode / title / pending / interrupted / apiError / lastActivity)。
//
// 判定顺序(offline 放最后,只有所有已知 claude 屏都不中、且有 shell 证据才 offline,
// 否则 unknown):
//   1) select  →  'select'
//   2) usage   →  'usage'   (/cost 与 /usage 同一个面板)
//   3) help    →  'help'
//   4) status  →  'status'
//   5) busy    →  jsonl detectTurn 若 'awaiting-tool' 则 'awaiting-tool' 否则 'generating'
//   6) idle    →  'idle'
//   7) offline →  'offline'
//   8) 其余     →  'unknown'
import type { JEvent, SessionState, Status } from './types.ts'
import { detectIdle } from './detectors/idle.ts'
import { detectBusy } from './detectors/busy.ts'
import { detectSelect, parseSelect } from './detectors/select.ts'
import { detectUsage } from './detectors/usage.ts'
import { detectHelp } from './detectors/help.ts'
import { detectStatus } from './detectors/status.ts'
import { detectConfig } from './detectors/config.ts'
import { detectStats } from './detectors/stats.ts'
import { detectMcp } from './detectors/mcp.ts'
import { detectPlugin } from './detectors/plugin.ts'
import { detectOffline } from './detectors/offline.ts'
import { detectCompact } from './detectors/compact.ts'
import {
  detectTurn,
  detectMode,
  detectPermissionMode,
  detectTitle,
  detectInterrupted,
  detectApiError,
  detectPending,
  detectLastActivity,
  detectTurnMeta,
} from './detectors/jsonl.ts'
import { detectTasks } from './detectors/tasks.ts'

export * from './types.ts'

// re-export 各检测器(供 server/state-check.ts 等外部调用)。
export { detectIdle } from './detectors/idle.ts'
export { detectBusy } from './detectors/busy.ts'
export { detectSelect, parseSelect } from './detectors/select.ts'
export type { SelectView, SelectOption } from './detectors/select.ts'
export { detectUsage } from './detectors/usage.ts'
export { detectHelp } from './detectors/help.ts'
export { detectStatus } from './detectors/status.ts'
export { detectConfig } from './detectors/config.ts'
export { detectStats } from './detectors/stats.ts'
export { detectMcp } from './detectors/mcp.ts'
export { detectPlugin } from './detectors/plugin.ts'
export { detectOffline } from './detectors/offline.ts'
export { detectCompact } from './detectors/compact.ts'
export {
  detectTurn,
  detectMode,
  detectPermissionMode,
  detectTitle,
  detectInterrupted,
  detectApiError,
  detectPending,
  detectLastActivity,
  detectTurnMeta,
} from './detectors/jsonl.ts'
export { detectTasks } from './detectors/tasks.ts'

export function sessionStatus(events: JEvent[], screen: string[], suggest = ''): SessionState {
  // status 优先屏判(更准);但 chat 隐藏终端常连不上(无 live tmux 的历史会话尤甚),此时 screen 为空,
  // 所有屏判落空。与其一律 unknown,不如退回 jsonl 尾部推断(detectTurn:idle/generating/awaiting-tool)。
  let source: 'screen' | 'jsonl' = 'screen'
  let status: Status

  if (detectSelect(screen)) {
    status = 'select'
  } else if (detectUsage(screen)) {
    status = 'usage'
  } else if (detectHelp(screen)) {
    status = 'help'
  } else if (detectStatus(screen)) {
    status = 'status'
  } else if (detectConfig(screen)) {
    status = 'config'
  } else if (detectStats(screen)) {
    status = 'stats'
  } else if (detectMcp(screen)) {
    status = 'mcp'
  } else if (detectPlugin(screen)) {
    status = 'plugin'
  } else if (detectBusy(screen)) {
    // 屏幕权威判「忙」;jsonl 细分:工具在飞(awaiting-tool)vs 生成文本(generating)。
    status = detectTurn(events) === 'awaiting-tool' ? 'awaiting-tool' : 'generating'
  } else if (detectIdle(screen)) {
    status = 'idle'
  } else if (detectOffline(screen)) {
    // 所有已知 claude 屏都不中,且末尾窗口有 shell 证据 → 落回 shell。
    status = 'offline'
  } else if (events.length) {
    // 屏判认不出(终端没连、读不到、或隐藏终端尺寸下 TUI 渲染不标准)但有 jsonl 历史
    // → 用 jsonl 尾部推断(idle/generating/awaiting-tool),而非一律 unknown。chat 视图本就以 jsonl 为准。
    status = detectTurn(events)
    source = 'jsonl'
  } else {
    status = 'unknown' // 既认不出屏、又无 jsonl → 真未知
  }

  const pending = detectPending(events)
  const turnMeta = detectTurnMeta(events)
  return {
    status,
    source,
    mode: detectMode(events),
    permissionMode: detectPermissionMode(events),
    title: detectTitle(events),
    pendingAgents: pending.agents,
    pendingWorkflows: pending.workflows,
    interrupted: detectInterrupted(events),
    apiError: detectApiError(events),
    lastActivity: detectLastActivity(events),
    suggest: suggest || null,
    tasks: detectTasks(events),
    turnStartedAt: turnMeta.startedAt,
    turnTokens: turnMeta.outputTokens,
    select: status === 'select' ? parseSelect(screen) : null,
    compactPct: detectCompact(screen), // /compact 进行中的真·百分比(读屏);否则 null
  }
}
