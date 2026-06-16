// idle 屏幕态检测器(独立单元)。
// 语义:空闲输入框 —— 纯 ─── 边框 + ❯ 输入行 + 空闲 footer
//   「← for agents / ? for shortcuts / to send」,且**不含**「esc to interrupt」。
//
//   注意 busy 也有同款输入框(同样的 ─── + ❯),区别只在 footer 后缀:
//   busy/subagent 的 footer 带「esc to interrupt」,idle 不带。所以先排除它,
//   再认空闲 footer 锚点。
//
// 锚点选择:用面板里稳定出现的内容特征 —— 空闲 footer 文案 + 输入框骨架
//   (纯 ─ 边框线 + ❯ 输入行)。不依赖会随消息滚出视口的 "Esc to cancel"。
//
// 视口窗口:线上经 ttyd/xterm 读屏时,最后一行是 tmux 状态栏(fixture 不含它),
//   所以扫「末尾若干行」而非假设 footer 就是最后一行。窗口取 12 行,足够覆盖
//   输入框(上下 ─ 边框)+ footer + tmux 状态栏的余量。

// busy/subagent 的生成期 footer —— 出现即非 idle。大小写不敏感。
import { tail } from '../region.ts'

const RE_INTERRUPT = /esc\s+to\s+interrupt/i

// 空闲 footer 的内容锚点(任一命中即可):
//   「← for agents」代理入口提示;「? for shortcuts」快捷键提示;
//   「to send」发送提示(↵/⏎ to send)。这些是空闲输入框 footer 的稳定文案,
//   而 select/help/status 等浮窗用的是「Esc to cancel」,usage/cost/offline 无 footer。
//   注意:「← for agents / ? for shortcuts」是**输入框为空时的占位提示**,一打字就消失;
//   模式提示「shift+tab to cycle」(auto/bypass 模式)在空和打字时都在,必须纳入,否则
//   「输入框里有文字」会被误判 unknown。help 表里有 "shift + tab" 但没 "to cycle",用完整短语区分。
const RE_IDLE_FOOTER =
  /←\s*for\s+agents|\?\s*for\s+shortcuts|to\s+send|shift\s*\+\s*tab\s+to\s+cycle/i

// 输入框提示行:某行去掉前导空白后以 ❯ 开头(空输入框 ❯ 后只跟空白)。
const RE_PROMPT_ROW = /^\s*[❯›>]/

// 纯 ─ 边框线:整行只由 ─(U+2500)与空白构成,且至少 20 个 ─(排除偶发短横)。
const RE_BORDER = /^\s*─{20,}\s*$/

// 末尾窗口行数:留出输入框上下边框 + footer + tmux 状态栏的余量。
const TAIL = 12

export function detectIdle(lines: string[]): boolean {
  const win = tail(lines, TAIL)

  // busy/subagent:footer 带 esc to interrupt —— 直接否。
  if (win.some((l) => RE_INTERRUPT.test(l))) return false

  // 空闲 footer 锚点必须在场。
  if (!win.some((l) => RE_IDLE_FOOTER.test(l))) return false

  // 输入框骨架:存在 ❯ 输入行 + 纯 ─ 边框线。
  const hasPrompt = win.some((l) => RE_PROMPT_ROW.test(l))
  const hasBorder = win.some((l) => RE_BORDER.test(l))

  return hasPrompt && hasBorder
}
