// region.ts — 屏判检测器共享的「窗口 + 锚点」原语。
//
// 各检测器原本各自手写 `lines.slice(-N)`、`win.some(l => re.test(l))`、命中计数等同一套机制
// (busy 尾 10、usage 尾 30、status 尾 24、idle 尾 12、offline 滤空后尾 8…)。抽到这里统一:
//   - 去掉复制粘贴;
//   - 把「扫哪段、怎么算命中」收成一个集中改点 —— 后续「结构锚点强化」(要求 overlay 边框/底栏、
//     限定匹配区域、强/弱锚点分级)就落在这里 + 各检测器一处,而不是散在 14 个文件里。
//
// 本模块只提供机制,不含任何具体面板的锚点正则 —— 那些仍归各 detector 自己持有。

// 末尾窗口:取最后 n 行。屏判面板 / footer 都渲染在屏幕底部;线上经 ttyd/xterm 读屏时末行
// 可能粘着 tmux 状态栏,故扫「末尾窗口」而非假设证据就在最后一行。
export const tail = (lines: string[], n: number): string[] => lines.slice(-n)

// 末尾窗口(先滤掉纯空行,再取 n 行)—— offline 的口径(绕开面板与 shell 之间的空白行)。
export const tailNonBlank = (lines: string[], n: number): string[] =>
  lines.filter((l) => l.trim()).slice(-n)

// 窗口内是否存在「任一行命中任一正则」。
export const anyLine = (lines: string[], res: RegExp[]): boolean =>
  lines.some((l) => res.some((re) => re.test(l)))

// 窗口内「命中(任一锚点的)行数」—— 用于「≥N 个锚点」式判定(如 help)。
export const countHits = (lines: string[], res: RegExp[]): number => {
  let n = 0
  for (const l of lines) if (res.some((re) => re.test(l))) n++
  return n
}
