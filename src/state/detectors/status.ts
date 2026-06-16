// detectStatus —— 屏幕状态「status」的独立检测器。
//
// 语义:claude 的「状态面板」全屏浮层(/status)。它列出 Version / Session / cwd /
// Login method / Organization / Email / Model / MCP servers / Setting sources 等。
//
// 锚点策略:用面板里稳定出现、且其它面板没有的「字段标签」当内容特征锚点 ——
//   - "Setting sources" (设置来源)
//   - "MCP servers"     (注意 /context 面板里是 "MCP tools",不是 "servers")
//   - "Login method"
//   - "Session ID" / "Session name"
// 顶部「╭─── Claude Code v… ───╮」方框、"Welcome back"、以及 tab 行
// 「Settings  Status   Config   Usage   Stats」都不能单独当锚点:前两者 idle/help 也有,
// tab 行 usage/cost 面板同样有,会误判。
//
// 不依赖会滚出视口的 "Esc to cancel"(它是最后一行,经 ttyd/xterm 读屏时还会被 tmux
// 状态栏挤掉)。改为「扫末尾若干行的窗口」找字段标签 —— 不假设 footer 就是最后一行,
// 给 tmux 状态栏留出余量。任一锚点命中即算 status。

// 字段标签锚点:行内出现「标签 + 冒号」即可(冒号后跟值,或本测试样本里跟多个对齐空格)。
import { tail, anyLine } from '../region.ts'

const reAnchors = [
  /\bSetting sources\b/i,
  /\bMCP servers:/i, // 带冒号 = status 的字段标签;避免误命中 /mcp 面板标题「Manage MCP servers」
  /\bLogin method\b/i,
  /\bSession ID\b/i,
  /\bSession name\b/i,
]

// 扫末尾窗口的行数。状态面板的字段标签集中在面板下半部;给 tmux 状态栏 + 留白留足余量。
const TAIL = 24

export function detectStatus(lines: string[]): boolean {
  return anyLine(tail(lines, TAIL), reAnchors)
}
