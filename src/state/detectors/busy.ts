// busy 屏幕态检测器(独立单元)。
// 语义:claude 正在生成 / 等工具 —— 末尾窗口的 footer 出现「esc to interrupt」。
// subagent 帧同样算 busy:底部多了一截代理坞(Agent(...) 行 + ↑/↓ to select),
//   但只要 footer 仍带「esc to interrupt」就够判,无需依赖代理坞本身。
//
// 锚点选择:用稳定的内容特征「esc to interrupt」(生成期 footer 永远在),
//   不依赖会随消息滚出视口的 "Esc to cancel" 之类。
//
// 视口窗口:线上经 ttyd/xterm 读屏时,最后一行是 tmux 状态栏(fixture 不含它),
//   所以扫「末尾若干行」而非假设 footer 就是最后一行。窗口取 10 行,足够覆盖
//   代理坞(busy footer 之下还有 1~3 行代理坞)+ tmux 状态栏。

// "esc to interrupt" —— 大小写不敏感;中间的分隔符容忍普通空格 / 不间断空格( )。
import { tail, anyLine } from '../region.ts'

const RE_INTERRUPT = /esc\s+to\s+interrupt/i

// 末尾窗口行数:留出 footer + 代理坞 + tmux 状态栏的余量。
const TAIL = 10

export function detectBusy(lines: string[]): boolean {
  return anyLine(tail(lines, TAIL), [RE_INTERRUPT])
}
