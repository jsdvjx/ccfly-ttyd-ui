// 共享类型契约(各检测器/组合器只 import 不改)。
import type { SelectView } from './detectors/select.ts'
export type { SelectView, SelectOption } from './detectors/select.ts'

// 顶层状态。screen 路:idle/busy(generating|awaiting-tool)/select/各浮窗/offline;
// jsonl 给 busy 的子类型 + 元数据。认不出的 claude 屏 → unknown。
export type Status =
  | 'offline'
  | 'idle'
  | 'generating'
  | 'awaiting-tool'
  | 'select'
  | 'usage' // /cost 与 /usage 是同一个面板
  | 'help'
  | 'status'
  | 'config' // /config:设置浮层(Search settings + 开关列表)
  | 'stats' // 设置浮层的 Stats tab(Overview / Models 两个子页)
  | 'mcp' // /mcp:MCP 服务器管理面板
  | 'plugin' // /plugin:插件管理器
  | 'unknown'

// JEvent — jsonl 一行(只声明判断要用到的字段,其余放宽)。
export interface JEvent {
  type?: string
  uuid?: string
  isMeta?: boolean
  message?: {
    role?: string
    content?: unknown
    stop_reason?: string | null
    usage?: Record<string, number>
    model?: string
  }
  content?: string // system 行的顶层内容(如 local_command 的 <local-command-stdout>…)
  mode?: string
  permissionMode?: string
  aiTitle?: string
  interruptedMessageId?: string
  isApiErrorMessage?: boolean
  apiErrorStatus?: string | number
  error?: string
  subtype?: string
  pendingBackgroundAgentCount?: number
  pendingWorkflowCount?: number
  timestamp?: string
  toolUseResult?: unknown
  [k: string]: unknown
}

export interface SessionState {
  status: Status
  source: 'screen' | 'jsonl'
  mode: string | null
  permissionMode: string | null
  title: string | null
  pendingAgents: number
  pendingWorkflows: number
  interrupted: boolean
  apiError: { status?: string; error?: string } | null
  lastActivity: string | null
  suggest: string | null // 空输入时的建议鬼影(来自 cell dim,见 readSuggest)
  tasks: TaskItem[] // 当前任务列表(TodoWrite 快照 + TaskCreate/TaskUpdate 折叠,见 detectTasks)
  turnStartedAt: string | null // 当前回合起点 = 最后一条真实 user prompt 的 timestamp
  turnTokens: number // 该起点之后 assistant 的 output_tokens 累计(对齐 TUI 的 ↑ 计数)
  select: SelectView | null // status==='select' 时解析出的菜单(标题+选项),供 UI 渲染可点选项
  compactPct: number | null // /compact 进行中,读屏得到的真·进度百分比(0..100);未在压缩 → null
}

// 任务项(TUI 的任务列表)。id 在 TaskCreate 结果落盘前未知 → null;TodoWrite 项用序号。
export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export interface TaskItem {
  id: string | null
  subject: string
  status: TaskStatus
  activeForm?: string
}
