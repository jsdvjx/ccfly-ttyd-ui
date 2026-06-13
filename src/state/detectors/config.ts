// config 屏幕态检测器(独立单元)。
// 语义:/config 打开的设置浮层 —— 顶部「⌕ Search settings…」搜索框 + 一列开关
//   (Auto-compact / Show tips / Default permission mode …)。与 status/usage/stats 同属
//   设置浮层的不同 tab(tab 行「Settings Status Config Usage Stats」),靠各自正文区分。
//
// 锚点:「Search settings」搜索框文案 —— 仅此 tab 有,status/usage/stats/help 都没有。
//   整屏扫(搜索框在浮层顶部,可能落在末尾窗口之外)。不依赖会滚出视口的 "Esc to cancel"。
const RE_SEARCH_SETTINGS = /Search settings/i

export function detectConfig(lines: string[]): boolean {
  return lines.some((l) => RE_SEARCH_SETTINGS.test(l))
}
