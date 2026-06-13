// fmt.ts — 人类易读的小格式化:时长(h/m/s)与 token(k/M)。

// fmtDur — 秒 → 紧凑 h/m/s,如 45s / 12m1s / 1h2m。
export function fmtDur(sec?: number): string {
  const s = Math.round(sec ?? 0)
  if (s <= 0) return '0s'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h) return m ? `${h}h${m}m` : `${h}h`
  if (m) return ss ? `${m}m${ss}s` : `${m}m`
  return `${ss}s`
}

// fmtTok — token 数 → 1.2k / 74.6k / 1.3M(整千/整百万省略小数,对齐 TUI 的 21.7k 写法)。
export function fmtTok(n?: number): string {
  const v = n ?? 0
  if (v < 1000) return String(v)
  const unit = v < 1e6 ? 'k' : 'M'
  const x = v < 1e6 ? v / 1000 : v / 1e6
  return (Number.isInteger(x) ? x.toFixed(0) : x.toFixed(1)) + unit
}

// fmtPermMode — Claude 权限模式 → 中文短标签(bypassPermissions 等原词太长,移动端放不下)。
// 认不出的值原样返回,不丢信息。
export function fmtPermMode(mode?: string | null): string {
  switch (mode) {
    case 'default':
      return '默认'
    case 'plan':
      return '规划'
    case 'acceptEdits':
      return '自动改'
    case 'bypassPermissions':
      return '免确认'
    default:
      return mode ?? ''
  }
}

// fmtStatus — 界面态(state.status)→ 中文短标签(聚合展示在输入框的状态条)。
export function fmtStatus(st?: string | null): string {
  switch (st) {
    case 'offline':
      return '离线'
    case 'idle':
      return '空闲'
    case 'generating':
      return '生成中'
    case 'awaiting-tool':
      return '执行工具'
    case 'select':
      return '等待选择'
    case 'usage':
      return '用量面板'
    case 'help':
      return '帮助面板'
    case 'status':
      return '状态面板'
    case 'config':
      return '设置面板'
    case 'stats':
      return '统计面板'
    case 'mcp':
      return 'MCP 面板'
    case 'plugin':
      return '插件面板'
    case 'unknown':
      return '未知'
    default:
      return st ?? ''
  }
}
