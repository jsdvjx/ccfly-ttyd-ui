// detectOffline — 独立检测器:判断屏幕是否落回 shell(claude 没在跑)。
//
// 语义:offline 是「最后兜底」。claude 的所有屏(idle/busy/select/usage/cost/
// help/status/context/subagent)都必须判 false —— 包括那些没有外边框的全屏浮层
// (/cost、/usage、/context),所以**不能**用「没有边框」来判 offline,否则浮层会被误判。
//
// 正确做法:正面找 shell 证据。先排除任何「claude 框架」(边框 / 忙碌·空闲提示行 /
// 菜单底栏 / Settings 选项卡 / 用量面板的 Resets 行 / auto mode 行);确定屏上没有
// claude 的任何痕迹后,再要求末尾窗口里出现实打实的 shell 证据才算 offline。
// 宁可漏判(落到 idle/unknown)也别误判 claude 屏。
//
// 关于 tmux 状态栏:线上经 ttyd/xterm 读屏时,最后一行往往是 tmux 状态栏,而不是
// shell 提示/报错。因此检测器扫「末尾若干行的窗口」,不假设证据就在最后一行。

// ── claude 框架锚点(命中任意一个 → 这是 claude 屏,不是 offline)───────────────
// 外边框 / 长横线 / 浮层顶部的 ▔ 横条。
import { anyLine, tailNonBlank } from '../region.ts'

const reBorder = /[╭╮╰╯]|─{6,}|▔{6,}/
// 忙碌底栏后缀。
const reBusy = /esc\s+to\s+interrupt/i
// 空闲输入提示行 / auto mode 行。
const reIdleHint =
  /(\?\s*for\s+shortcuts|←\s*for\s+agents|\bto\s+send\b|shift\s*\+\s*tab|auto mode on)/i
// 菜单 / 浮层底栏(Enter…to / Esc to cancel / ←/→ to adjust)。
const reFooter = /(\b(esc|enter)\b.*\bto\b|←\/→\s*to adjust|Esc to cancel)/i
// /status·/usage·/cost·/help 等面板顶部的选项卡行。
const reTabbar = /\b(Settings|Help)\b\s+\b(Status|General)\b/
// 用量面板特征:每段额度都有「Resets … (时区)」。
const reResets = /\bResets\b.*\(/
// /context·/cost·/usage 面板里的 token / 用量措辞,作为浮层兜底锚点。
const rePanelText = /(Context Usage|tokens \(\d|Total cost:|Total duration|% used)/

// ── shell(offline)正面证据 ──────────────────────────────────────────────────
// shell 报错行:zsh: command not found: … / bash: … 等。
const reShellErr = /^(zsh|bash|fish|sh|dash|ksh):\s/
// starship 提示行尾的「at HH:MM(:SS)」时间段。
const reStarshipTime = /\bat\s+\d{1,2}:\d{2}(:\d{2})?\s*$/

function hasClaudeChrome(lines: string[]): boolean {
  return anyLine(lines, [reBorder, reBusy, reIdleHint, reFooter, reTabbar, reResets, rePanelText])
}

export function detectOffline(lines: string[]): boolean {
  // 屏上有任何 claude 痕迹 → 不是 offline。
  if (hasClaudeChrome(lines)) return false
  // 末尾窗口里找 shell 证据(扫多行,绕开末行可能是 tmux 状态栏的情况)。
  const win = tailNonBlank(lines, 8)
  return win.some((l) => reShellErr.test(l.trim()) || reStarshipTime.test(l))
}
