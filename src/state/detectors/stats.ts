// stats 屏幕态检测器(独立单元)。
// 语义:设置浮层的 Stats tab。它有**两个子页**:Overview(日历热力图 + Favorite model/
//   Total tokens/Sessions/streak)与 Models(Tokens per Day 柱状图)。两个子页都带
//   子tab行「Overview   Models」。
//
// 锚点:子tab行「Overview … Models」—— 两个子页都有、且仅 Stats 独有(其它 tab 没有)。
//   整屏扫(子tab行在浮层上部,可能落在末尾窗口之外)。
const RE_STATS_SUBTABS = /\bOverview\s+Models\b/

export function detectStats(lines: string[]): boolean {
  return lines.some((l) => RE_STATS_SUBTABS.test(l))
}
