// detectHelp — 屏幕「帮助面板」(/help)的独立检测器。
//
// /help 弹出的是一个全屏帮助页:顶部一排 tab(Help / General / Commands / Custom commands),
// 一段说明,后面是「Shortcuts」快捷键表,底部给出「/keybindings to customize」和
// 「For more help: https://code.claude.com/...」。
//
// 设计要点:
// - 用「内容特征锚点」(面板里稳定出现的文字),不依赖会滚出视口的 "Esc to cancel"。
// - tab 行(Settings/Status/...)在 /status、/cost、/usage 面板里也有类似形态,所以
//   不能只靠「一排 tab」判断;帮助面板的强唯一锚点是 `/keybindings` 与 `code.claude.com` 的帮助链接。
// - 不假设锚点在最后一行:线上经 ttyd/xterm 读屏时最后一行可能是 tmux 状态栏,面板正文
//   会被它顶上去,所以整屏扫描(锚点都在面板正文里,稳定可见)。
// - 要≥2 个锚点同时命中,避免普通对话里偶然提到某条快捷键就误判。

// 强锚点:几乎只在帮助面板里出现。
import { countHits } from '../region.ts'

const reKeybindings = /\/keybindings\b/i // 「/keybindings to customize」
const reMoreHelpUrl = /For\s+more\s+help:.*code\.claude\.com/i // 帮助文档链接
const reShortcutsHeading = /^\s*Shortcuts\s*$/i // 「Shortcuts」小标题

// 辅助锚点:快捷键表里的稳定条目(单独不足以判定,凑数用)。
const reShellMode = /!\s+for\s+shell\s+mode/i // 「! for shell mode」
const reForCommands = /\/\s+for\s+commands/i // 「/ for commands」
const reForFilePaths = /@\s+for\s+file\s+paths/i // 「@ for file paths」
// 「ctrl + … to …」快捷键说明(表格里大量出现)。
const reCtrlShortcut = /ctrl\s*\+\s*\S.*\bto\b/i

const anchors = [
  reKeybindings,
  reMoreHelpUrl,
  reShortcutsHeading,
  reShellMode,
  reForCommands,
  reForFilePaths,
  reCtrlShortcut,
]

export function detectHelp(lines: string[]): boolean {
  // ≥2 个锚点命中(同 ctrl-shortcut 表里多条同时出现)→ help。
  return countHits(lines, anchors) >= 2
}
