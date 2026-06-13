// useSessions — 拉取 /sessions 会话列表(契约端点),定时刷新。
import { ref, onUnmounted } from 'vue'
import { sessionsUrl } from '../config'

export interface SessionMeta {
  session_id: string
  title?: string
  state: string // working / idle / ...
  model?: string
  cwd: string
  age_sec: number
  live: boolean
  turns: number
  tokens: number
  cols?: number // 当前 tmux 窗口尺寸(chat 隐藏终端自适应用;老节点无此字段)
  rows?: number
  attached?: number // 已连接客户端数(>0 表示有人在连,沿用其尺寸、不 resize)
  tmux?: string // 实际跑在的 tmux 会话名(扛 /clear 名字残留;/clear 跟随用)
}

export function useSessions(intervalMs = 5000) {
  const sessions = ref<SessionMeta[]>([])
  const error = ref('')

  async function refresh() {
    try {
      const r = await fetch(sessionsUrl())
      if (!r.ok) throw new Error('HTTP ' + r.status)
      sessions.value = (await r.json()) as SessionMeta[]
      error.value = ''
    } catch (e) {
      error.value = String(e)
    }
  }

  const timer = window.setInterval(refresh, intervalMs)
  void refresh()
  onUnmounted(() => clearInterval(timer))

  return { sessions, error, refresh }
}
