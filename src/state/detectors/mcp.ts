// detectMcp —— 屏幕状态「mcp」的独立检测器(/mcp 浮层)。
// 语义:MCP 服务器管理面板,标题「Manage MCP servers」+「N servers」+ User/Built-in MCPs 列表
//   (如「fusion360 · ✔ connected · 2 tools」)。
//
// 锚点:标题「Manage MCP servers」/ 分组「Built-in MCPs」—— 仅此面板有。
//   注意与 /status 区分:status 面板是字段「MCP servers:」(带冒号),这里是标题「Manage MCP servers」。
//   整屏扫(标题在浮层顶部,可能落在末尾窗口之外)。
const RE_MCP = /Manage MCP servers|Built-in MCPs/i

export function detectMcp(lines: string[]): boolean {
  return lines.some((l) => RE_MCP.test(l))
}
