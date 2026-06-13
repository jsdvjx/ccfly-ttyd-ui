// hub/api.ts — cc.hn(Hub)控制面的 REST 客户端 + 共享类型 + 展示格式化。
// 移植自 ccfly-cloud/web/src/App.tsx;端点契约由 cc.hn 提供,本项目只是它的前端。

// 所有 cc.hn API 都用同源 cookie 鉴权(OAuth→HMAC session)。
export function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(path, { credentials: 'same-origin', ...opts })
}

export interface Device {
  id: string
  name: string
  online?: boolean
  overlay_ip?: string
  connect_code?: string
  connect?: string
  version?: string // 设备端上报的客户端版本(老设备不上报则为空)
  os?: string
  arch?: string
  enrolled_at?: number // unix 秒;缺省 = 从未接入(只建了记录,没跑过 connect)
  last_seen?: number // unix 秒;离线设备的「最近在线」
}

export interface SessionRow {
  session_id: string
  title?: string
  state?: string
  turns?: number
  model?: string
  cwd?: string
  mtime_ms?: number
  live?: boolean
  tmux?: string // 该会话实际跑在的 tmux 会话名(设备端解析,扛 /clear;老设备不带)
}

export interface PairInfo {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  os?: string
  arch?: string
  version?: string
  hostname?: string
  suggestedName?: string
  expiresInSec?: number
}

// 登录后回跳到配对确认页的暂存 key(见 App / LinkPage)。
export const PENDING_LINK_KEY = 'ccfly_pending_link'

// 退出登录(会话/设备两个一级页头部共用)。
export function logout(): void {
  api('/auth/logout', { method: 'POST' }).then(() => location.reload())
}

export function provLabel(p: string): string {
  return p === 'github' ? 'GitHub' : p === 'google' ? 'Google' : p === 'feishu' ? '飞书' : p
}

const KNOWN_STATES = ['working', 'awaiting_input', 'error', 'idle', 'closed']
export function stateClass(s?: string): string {
  return s && KNOWN_STATES.includes(s) ? 'b-' + s : 'b-unknown'
}

// 状态码 → 简短中文标签(badge 固定 min-width 居中,列表对齐不抖)。
const STATE_LABELS: Record<string, string> = {
  working: '运行',
  awaiting_input: '待输入',
  error: '错误',
  idle: '空闲',
  closed: '已关',
  unknown: '未知',
}
export function stateLabel(s?: string): string {
  return (s && STATE_LABELS[s]) || STATE_LABELS.unknown
}

export function shortModel(m?: string): string {
  if (!m) return ''
  const x = m.toLowerCase()
  return x.includes('opus')
    ? 'opus'
    : x.includes('sonnet')
      ? 'sonnet'
      : x.includes('haiku')
        ? 'haiku'
        : m
}

export function relTime(ms?: number): string {
  if (!ms) return ''
  const d = Date.now() - ms
  if (d < 60000) return '刚刚'
  const m = Math.floor(d / 60000)
  if (m < 60) return m + '分前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + '时前'
  return Math.floor(h / 24) + '天前'
}

export function basename(p: string): string {
  if (!p) return ''
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}
