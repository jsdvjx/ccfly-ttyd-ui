// transcript/parseContext.ts — 把 /context 的 local-command-stdout 解析成结构化数据,供 ContextCard 富渲染。
//
// 数据来源:system/local_command 行的 content = `<local-command-stdout>…</local-command-stdout>`,内含 ANSI
// 着色的「方格图 + 分类明细 + 页脚」。TUI 用方格(⛀⛁⛂⛃ 已用 / ⛶ 空)拼出用量;这里**不**复刻终端美术,
// 而是把右侧那列文本(模型名 / 模型 id / 总量 / 各分类 token+占比 / MCP·Skills 页脚)抽出来,交给组件画干净的条形图。
//
// 解析要点:每行 = `<20 格方格>   <右侧文本>`,右侧文本可能自带一个 bullet(⛁ System prompt…)。先按 ANSI 剥色,
// 再用「连续 ≥5 个 方格+空格」吃掉左侧方格列(顺带把右侧 bullet 也吞掉,正好得到纯文本),最后逐行按语义归类。

const reANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
// 方格字符:⛀⛁⛂⛃(U+26C0–26C3)+ ⛶(U+26F6)。
const STRIP_GRID = /^\s*(?:[⛀-⛃⛶]\s+){5,}/

export interface CtxCategory {
  label: string // "System prompt"
  tokens: number // 解析后的数值(2500)
  tokensLabel: string // 原文("2.5k")
  pct: number // 0.3
}

export interface CtxExtra {
  title: string // "MCP tools"
  sub?: string // "/mcp (loaded on-demand)"
  detail?: string // "8 tools · 0 tokens"
}

export interface ContextUsage {
  model?: string // "Opus 4.8 (1M context)"
  modelId?: string // "claude-opus-4-8[1m]"
  usedLabel?: string // "18.5k"
  totalLabel?: string // "1M"
  usedPct?: number // 2
  categories: CtxCategory[]
  extras: CtxExtra[]
  hint?: string // "/context all to expand"
}

export interface SlashInvoke {
  name: string // "/context"
  args?: string
}

// 从 content 里取出 <local-command-stdout> 内文(无标签则原样返回)。
function extractStdout(raw: string): string {
  const m = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(raw)
  return m ? m[1] : raw
}

// "2.5k" / "1m" / "8" / "981.5k" → 数值。
function parseTok(s?: string): number {
  if (!s) return 0
  const m = /^([\d.]+)\s*([kKmM]?)/.exec(s.trim())
  if (!m) return 0
  let n = parseFloat(m[1])
  const u = m[2].toLowerCase()
  if (u === 'k') n *= 1e3
  else if (u === 'm') n *= 1e6
  return Math.round(n)
}

// 单位大写化,展示用("1m" → "1M","18.5k" → "18.5K")。
function upUnit(s?: string): string | undefined {
  return s?.replace(/k$/i, 'K').replace(/m$/i, 'M')
}

// parseContextUsage — 解析 /context 输出;非 /context(无 "Context Usage" 锚点)或无可用信息时返回 null。
export function parseContextUsage(raw: string): ContextUsage | null {
  const body = extractStdout(raw).replace(reANSI, '')
  if (!/Context Usage/i.test(body)) return null

  const lines = body.split('\n').map((l) => l.replace(STRIP_GRID, '').trim())
  const out: ContextUsage = { categories: [], extras: [] }

  const reTotal = /^([\d.]+[kmKM]?)\s*\/\s*([\d.]+[kmKM]?)\s*tokens?\s*\((\d+)%\)/
  const reCat = /^(.+?):\s*([\d.]+[kmKM]?|\d+)\s*(?:tokens?\s*)?\((\d+(?:\.\d+)?)%\)/
  // 模型 id:无空格、带连字符/点分段、可带 [1m] 后缀,如 claude-opus-4-8[1m]。
  const reModelId = /^[a-z0-9]+(?:[-.][a-z0-9]+)+(?:\[[^\]]*\])?$/i

  let inCats = false
  for (const l of lines) {
    if (!l || /^Context Usage$/i.test(l)) continue

    const mt = reTotal.exec(l)
    if (mt && out.usedLabel === undefined) {
      out.usedLabel = upUnit(mt[1])
      out.totalLabel = upUnit(mt[2])
      out.usedPct = parseInt(mt[3], 10)
      continue
    }

    if (/Estimated usage by category/i.test(l)) {
      inCats = true
      continue
    }

    const mc = reCat.exec(l)
    if (mc && inCats) {
      out.categories.push({
        label: mc[1].trim(),
        tokensLabel: mc[2],
        tokens: parseTok(mc[2]),
        pct: parseFloat(mc[3]),
      })
      continue
    }

    // 页脚明细:"└ 8 tools · 0 tokens" 贴到上一个 extra。
    if (l.startsWith('└')) {
      const detail = l.replace(/^└\s*/, '').trim()
      const last = out.extras[out.extras.length - 1]
      if (last) last.detail = detail
      continue
    }

    if (/\ball to expand\b/i.test(l)) {
      out.hint = l
      continue
    }

    // 分类区之前:先模型名后模型 id(均为方格右侧首两行)。
    if (!inCats) {
      if (out.modelId === undefined && !/\s/.test(l) && reModelId.test(l)) {
        out.modelId = l
        continue
      }
      if (out.model === undefined) {
        out.model = l
        continue
      }
    }

    // 分类区之后的页脚标题:"MCP tools · /mcp (loaded on-demand)"。
    if (inCats && l.includes('·')) {
      const idx = l.indexOf('·')
      out.extras.push({ title: l.slice(0, idx).trim(), sub: l.slice(idx + 1).trim() })
      continue
    }
  }

  if (out.usedPct === undefined && out.categories.length === 0) return null
  return out
}

// isLocalCommandText — 是否 local-command 标记行。斜杠命令的回显/输出有时以 system/local_command
// 落盘,有时以 **user 事件**落盘(如 /model 真改了模型时);后者不能当真用户提问渲染原文,
// 要一并走 Notice 富渲染(卡片 / chip / 暗淡行)。
export function isLocalCommandText(raw: string): boolean {
  return /<(?:command-name|local-command-stdout|local-command-caveat)[\s>]/.test(raw)
}

// localStdoutPlain — 提取 <local-command-stdout> 纯文本(剥 ANSI)。caveat 行 → ''(整条隐藏);
// 无 stdout 标签 → null(交回 SystemNotice 兜底)。
export function localStdoutPlain(raw: string): string | null {
  if (/<local-command-caveat>/.test(raw)) return ''
  const m = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(raw)
  if (!m) return null
  return m[1].replace(reANSI, '').trim()
}

// parseSlashInvoke — 解析命令调用块 <command-name>/x</command-name>…<command-args>…</command-args>。
export function parseSlashInvoke(raw: string): SlashInvoke | null {
  const n = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw)
  if (!n) return null
  const a = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)
  const args = a ? a[1].trim() : ''
  return { name: n[1].trim(), args: args || undefined }
}
