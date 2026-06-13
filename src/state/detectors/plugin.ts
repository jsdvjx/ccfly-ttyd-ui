// detectPlugin —— 屏幕状态「plugin」的独立检测器(/plugin 浮层)。
// 语义:插件管理器,顶部 tab 行「Plugins  Discover  Installed  Marketplaces  Errors」+
//   列表(如「frontend-design · claude-plugins-official · 867K installs」)。tab 行在所有
//   子页(Discover/Installed/Marketplaces/Errors)都在,作为统一锚点。
//
// 锚点:插件 tab 行「Plugins … Discover … Installed」。注意它的搜索框是「⌕ Search…」,
//   与 config 的「Search settings」不同,不会撞 detectConfig。整屏扫(tab 行在顶部)。
const RE_PLUGIN_TABS = /\bPlugins\s+Discover\s+Installed\b/i

export function detectPlugin(lines: string[]): boolean {
  return lines.some((l) => RE_PLUGIN_TABS.test(l))
}
