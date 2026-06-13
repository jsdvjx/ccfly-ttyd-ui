import type { Terminal } from '@xterm/xterm'

// readScreen — 当前可见屏的一次快照:纯文本行(尾部空白已 trim)。
// 纯函数、无状态。以后 detect 吃的就是它的输出。
export function readScreen(term: Terminal): string[] {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.baseY + y)
    lines.push(line ? line.translateToString(true) : '')
  }
  return lines
}

// readSuggest — 输入框里的「建议鬼影」(空输入时 claude 显示的暗色 prompt suggestion)。
// 纯文本分不出暗色,必须读 cell 的 dim 属性:在输入行(❯ 起头)上收集 dim 字符即建议。
// 没建议 → 空串。用途:① 暴露为基础信息;② 让「输入框是否为空」能减掉这段鬼影(否则会把
// 建议当成真内容,导致 sendMessage 清空验证误判失败)。
export function readSuggest(term: Terminal): string {
  const buf = term.buffer.active
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.baseY + y)
    if (!line) continue
    const text = line.translateToString(true)
    if (!/^\s*[❯›>][  ]/.test(text)) continue // 输入行
    let dim = ''
    let head = ''
    let lastRev = ''
    for (let x = 0; x < line.length; x++) {
      const c = line.getCell(x)
      if (!c) continue
      const ch = c.getChars() || ' '
      if (c.isDim()) {
        if (!head && lastRev) head = lastRev // dim 段开始,把压在光标下的首字并回
        dim += ch
      } else if (c.isInverse()) {
        lastRev = ch
      }
    }
    const body = dim.trim()
    if (body) return (head.trim() + body).replace(/^[❯›>]\s*/, '').trim()
  }
  return ''
}
