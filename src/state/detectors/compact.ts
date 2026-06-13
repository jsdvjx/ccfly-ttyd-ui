// compact 进度检测器(独立单元)。
// 语义:claude 正在执行 /compact —— 屏上出现「· Compacting conversation…」,其下一行是进度条
//   「▰▰▱▱… NN%」。与自由式 LLM 总结不同,原生 /compact 确实报**真·百分比**(有可度量的进度),
//   故这里读屏取那个真值,UI 据此驱动真填充进度条 —— 而非编一条耗时曲线去骗。
//
// 锚点:行内含「Compacting conversation」(进行时,带 …);百分比在该行或紧随的 1~2 行(进度条
//   常单独成行)。只认这个上下文里的 NN%,避免抓到别处的百分比(如 /context 的「(2%)」)。
//   完成后该行变成过去式「Compacted (ctrl+o …)」,不匹配 /compacting/ → 自然回 null(= 收尾信号)。

const RE_COMPACTING = /compacting\s+conversation/i
const RE_PCT = /(\d{1,3})\s*%/

// detectCompact — 若正在压缩,返回进度百分比(0..100);否则 null。
// 找到「Compacting conversation…」但进度条尚未渲染出百分比(刚进入那一两帧)→ 记 0(已在压缩、进度未知起点),
// 让 UI 立即出卡;百分比一旦读到就跳到真值。
export function detectCompact(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (!RE_COMPACTING.test(lines[i])) continue
    for (let j = i; j <= i + 2 && j < lines.length; j++) {
      const m = RE_PCT.exec(lines[j])
      if (m) {
        const n = Number(m[1])
        if (n >= 0 && n <= 100) return n
      }
    }
    return 0
  }
  return null
}
