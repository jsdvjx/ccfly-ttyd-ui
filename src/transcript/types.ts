// transcript/types.ts — chat 视图的数据模型(对应 transcript.go 的 tItem/tBlock + Jarvis blocks)。
// 由 useTranscript 从 useJsonl 的原始 events[] 派生;每个 Item 渲染成一条消息,Block 是其内容片段。
import type { JEvent } from '../state/types'

export type BlockType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'image'
  | 'bash-input' // 用户 `!命令` 的输入(独立 user 行,content 形如 <bash-input>…</bash-input>)
  | 'bash-stdout' // 其输出(<bash-stdout>…</bash-stdout>)
  | 'bash-stderr' // 其错误输出(<bash-stderr>…</bash-stderr>)

// structuredPatch 的一个 hunk:lines[] 每行带前缀 ' '|'-'|'+'(与 TUI / git 同源)。
export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface Block {
  type: BlockType
  text?: string
  // tool_use
  id?: string
  name?: string
  input?: Record<string, unknown>
  // tool_result(贴在用户行;也会被 indexResults 收进 resultById 折进对应工具卡)
  forId?: string
  content?: string
  isError?: boolean
  patch?: PatchHunk[]
  // image:路径式 [Image: source: <path>] 用 path;base64 式(TUI 粘贴)用 mediaType+data;imgIdx 供 /image 定位
  path?: string
  mediaType?: string
  data?: string
  imgIdx?: number
}

export type Role = 'user' | 'assistant' | 'system'

export interface Item {
  role: Role
  kind?: string // system 子类型 / 细分(供注册表分发)
  text?: string // 顶层文本(字符串内容或首个 text 块),列表分组/dedup 用
  ts?: string
  uuid?: string
  model?: string // assistant:opus/sonnet/haiku
  outTokens?: number // assistant message.usage.output_tokens
  blocks?: Block[]
  raw?: JEvent // 原始行:分类器(classifyUserItem)与卡片取 isMeta/toolUseResult/error 等附加字段
}

export interface Turn {
  anchorUuid?: string // 该轮最后一条 assistant 的 uuid(锚点/滚动定位)
  durSec: number // 该轮耗时(首条→末条 ts)
  outTokens: number // 该轮 assistant 输出 token 合计
  items: Item[]
}
