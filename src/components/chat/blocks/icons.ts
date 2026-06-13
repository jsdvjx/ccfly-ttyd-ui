// icons.ts — 工具卡表头的小图标(行内 SVG,stroke=currentColor,随文字色)。
// 加一种工具的图标 = 加一行映射;未知工具名落默认(扳手),保证每个控件都有一枚修饰图标。
// SVG 是本地受信任的静态串(无用户数据),用 v-html 渲染(见 ToolRow 的 eslint 覆盖)。

const W = (inner: string): string =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const TERMINAL = W(
  '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M4.5 6.2l2 1.8-2 1.8"/><path d="M8.4 10h3"/>',
)
const DOC = W(
  '<path d="M4 1.8h4.6L12 5v9.2H4z"/><path d="M8.6 1.8V5H12"/><path d="M6 8h4M6 10.4h4"/>',
)
const PENCIL = W('<path d="M11.6 1.6l2.8 2.8-8.2 8.2-3.4.6.6-3.4z"/><path d="M10.4 2.8l2.8 2.8"/>')
const FILEPLUS = W(
  '<path d="M4 1.8h4.6L12 5v9.2H4z"/><path d="M8.6 1.8V5H12"/><path d="M8 7.2v4M6 9.2h4"/>',
)
const SEARCH = W('<circle cx="7" cy="7" r="4.3"/><path d="M10.4 10.4L14 14"/>')
const GLOBE = W(
  '<circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2c2.2 1.8 2.2 10.2 0 12M8 2c-2.2 1.8-2.2 10.2 0 12"/>',
)
const CHECK = W(
  '<path d="M6.5 4.4h7M6.5 8h7M6.5 11.6h7"/><path d="M2.2 4.3l1 1 1.6-1.8M2.2 7.9l1 1 1.6-1.8"/>',
)
const ROBOT = W(
  '<rect x="3.2" y="5.2" width="9.6" height="7" rx="1.6"/><path d="M8 5.2V2.8"/><circle cx="8" cy="2.3" r=".7"/><path d="M6.2 8.6h.01M9.8 8.6h.01"/>',
)
const SPARK = W('<path d="M8 2l1.3 3.4L12.7 6.7 9.3 8 8 11.4 6.7 8 3.3 6.7 6.7 5.4z"/>')
const WRENCH = W(
  '<path d="M10.7 2.2a3 3 0 00-3.9 3.9l-4.4 4.4 1.7 1.7 4.4-4.4a3 3 0 003.9-3.9L9.9 4.4 8.1 3.9 7.6 2.1z"/>',
)

const MAP: Record<string, string> = {
  Bash: TERMINAL,
  BashOutput: TERMINAL,
  Read: DOC,
  NotebookRead: DOC,
  Edit: PENCIL,
  MultiEdit: PENCIL,
  NotebookEdit: PENCIL,
  Write: FILEPLUS,
  Grep: SEARCH,
  Glob: SEARCH,
  WebFetch: GLOBE,
  WebSearch: GLOBE,
  TodoWrite: CHECK,
  Task: ROBOT,
  Thinking: SPARK,
}

// iconSvg — 工具名 → 行内 SVG 串;空名返回空(不出图标),未知名落扳手。
export function iconSvg(name?: string): string {
  if (!name) return ''
  return MAP[name] ?? WRENCH
}
