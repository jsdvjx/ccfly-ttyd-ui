// 用量面板检测器(/cost 与 /usage 是同一个面板,内容一致)。
//
// 锚点 = 面板里稳定出现的「用量统计」文字,而非会随滚动滚出视口的 "Esc to cancel"。
// 注意:tab 行里的 "Usage"(Settings/Status/Config/Usage/Stats)在 /help、/status、/context
// 等面板也出现,所以**不能**拿单词 "Usage" 当锚点 —— 必须用面板正文里的统计句式。
//
// 稳定锚点(只在 cost/usage 正文里出现):
//   - "% of your usage"            例:95% of your usage came from subagent-heavy sessions
//   - "Last 24h"                   24 小时用量小节标题
//   - "subagent-heavy sessions"    用量构成描述
//   - "contributing to your limits" "What's contributing to your limits usage?"
//
// 线上经 ttyd/xterm 读屏时末尾会多出 tmux 状态栏那一行,所以扫「末尾窗口」而非整屏更省;
// 但这些锚点散布在面板各处(底部那条会随滚动浮动),取一个足够大的尾窗口最稳。

const reUsageShare = /%\s*of your usage/i
const reLast24h = /Last\s*24h/i
const reSubagentHeavy = /subagent-heavy sessions/i
const reContributing = /contributing to your limits/i
// 首屏锚点(CDP 实测):面板开头是 "Current session / NN% used / Resets …",上面四个锚点都在
// 折叠线以下 —— 屏小时首屏根本看不到,导致检测不到。这两个句式只在用量面板出现:
const reCurrentScope = /Current\s+(session|week)\b/i
const reUsedPct = /\d+%\s*used\b/i

// detectUsage — 命中任一用量正文锚点即判定为用量面板。
// 这些锚点彼此独立、互不出现在其它面板,任一命中都足以确认;
// 多锚点 OR 也能扛住面板滚动导致某些行被裁掉的情况。
export function detectUsage(lines: string[]): boolean {
  // 取末尾足够大的窗口:面板正文行数多,且线上尾部可能粘着 tmux 状态栏。
  const win = lines.slice(-30)
  return win.some(
    (l) =>
      reUsageShare.test(l) ||
      reLast24h.test(l) ||
      reSubagentHeavy.test(l) ||
      reContributing.test(l) ||
      reCurrentScope.test(l) ||
      reUsedPct.test(l),
  )
}
