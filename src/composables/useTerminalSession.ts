// useTerminalSession — 隐藏/可见终端 + jsonl + state + send 的统一控制器。
// Workspace(term 态)与 ChatView(chat 态)共用一个实例:同一个 xterm 既驱动实时状态(state 检测器读屏),
// 又是唯一发送通道;jsonl 同源。把 Workspace 原先的内联接线抽到这里,并加两件事:
//   ① onMounted 若已选会话就立即 connect(修深链刷新不出终端的 bug,且不必等 /sessions);
//   ② chat 态终端隐藏(off-screen),**沿用现有 tmux 窗口尺寸**(从 /sessions 的 cols/rows 取),不 resize 系统 tmux。
import { ref, computed, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { useSessions } from './useSessions'
import { useLiveTerminal } from './useLiveTerminal'
import { useScreen } from './useScreen'
import { useJsonl } from './useJsonl'
import { sessionStatus } from '../state'
import { extractInputBox } from '../send/sendMessage'
import { termUrl, takeoverUrl, tmuxName } from '../config'

export type ViewMode = 'term' | 'chat'

export function useTerminalSession(termEl: Ref<HTMLElement | null>, mode: Ref<ViewMode>) {
  const { sessions, refresh: refreshSessions } = useSessions()
  const selSid = ref('') // 选中的 claude session id(展示/路由用;随 /clear、/compact、/resume 变)
  // anchor — 锁定的「稳定 tmux pane 名」(cc-<初始sid8>,一旦建好永不变)。jsonl/term/发送 全钉在它上,
  // 与会动的 selSid 解耦 —— 这是 /clear 跟随的根治点(不再用 cc-<当前sid8> 现算目标、逼服务端反查)。
  const anchor = ref('')

  // 选中会话的 /sessions 元数据。live=false ⇒ 节点端(fail-closed pane 解析)断言它没有可控的
  // tmux pane(如在 tmux 外直接跑的 claude)——终端永远连不上,UI 应呈现「只读」而非「断开重连」。
  const selMeta = computed(() => sessions.value.find((s) => s.session_id === selSid.value) ?? null)
  const termless = computed(() => selMeta.value?.live === false)

  // sel — 真正的 tmux 目标名。优先用锁定的稳定 pane 名 anchor;其次 /sessions 报的真实 pane 名
  // (selMeta.tmux,经服务端 panemap 真值表解析、扛 /clear);都还没就位时(深链首连)才兜底
  // cc-<sid8> 现算,由服务端经 panemap 反查一次。关键:selSid 变(/clear/compact)不改 anchor → sel 不变
  // → jsonl/term 不重连,服务端始终走最稳的 byName→当前sid 主路,switched 照常触发。
  const sel = computed(
    () => anchor.value || selMeta.value?.tmux || (selSid.value ? tmuxName(selSid.value) : ''),
  )
  const termUrlRef = computed(() => (sel.value ? termUrl(sel.value) : ''))
  const jsonlSrcRef = computed(() => (sel.value ? 'session:' + sel.value : ''))

  // 接管后授予的临时尺寸:tmux 即将被 /term new-session 新建,不存在「错误尺寸 resize 别人」的
  // 问题,任一合理默认即可;下一轮 /sessions 带回真实 cols/rows 后自然被 adoptSize 的首选分支取代。
  const takenSize = ref<{ cols: number; rows: number } | null>(null)
  watch(selSid, () => (takenSize.value = null)) // 换会话作废

  // chat 态采用的固定尺寸 = 选中会话「当前 tmux 窗口」的 cols/rows(已知才用)→ 终端沿用、不改 tmux。
  // term 态返回 null = 贴合可见容器(用户在直接看/用,理应用窗口尺寸)。老节点无 cols/rows → null 回落。
  const adoptSize = computed<{ cols: number; rows: number } | null>(() => {
    if (mode.value !== 'chat') return null
    const m = selMeta.value
    if (m && m.cols && m.rows && m.cols > 0 && m.rows > 0) {
      // 防御:tmux window-size=latest 下,窗口曾被 1 行的隐藏终端客户端压成 h=1(累积多个 attach 互相拖死)。
      // 过小的尺寸不可信 → 卡到合理下限(80×24)。这样本次 attach 不会再是 1 行,反而把窗口拉回正常,
      // claude 才能正常收发(1 行终端无法渲染输入框/接收 paste+回车)。
      return { cols: Math.max(m.cols, 80), rows: Math.max(m.rows, 24) }
    }
    return takenSize.value
  })

  // takeover — 接管:POST /takeover 让节点确定性杀掉该会话既有 claude 进程(防双写),
  // 成功后授予临时尺寸 → canConnect 翻转 → watch 自动连 /term → new-session -A 重建进 tmux。
  async function takeover(): Promise<void> {
    if (!selSid.value) throw new Error('未选中会话')
    const r = await fetch(takeoverUrl(tmuxName(selSid.value)), { method: 'POST' })
    if (!r.ok) {
      let msg = 'HTTP ' + r.status
      try {
        const j = (await r.json()) as { error?: string }
        if (j.error) msg = j.error
      } catch {
        /* 非 JSON 错误体:保留状态码文案 */
      }
      throw new Error(msg)
    }
    takenSize.value = { cols: 150, rows: 40 }
    void refreshSessions()
  }

  // 连接闸:term 态总连(选了会话即可);chat 态必须**先拿到现有尺寸**再连 —— 否则握手会用错误尺寸去
  // 改系统 tmux(见 useLiveTerminal.connect 注释)。这正是「连接前获取当前是否有连接,有就用已有分辨率」。
  // 代价:老节点(/sessions 无 cols/rows)chat 态不连终端 → 仍按 jsonl 渲染对话,只是暂不能发(节点二进制更新后自愈)。
  const canConnect = computed(() => {
    if (!sel.value) return false
    if (mode.value === 'chat') return adoptSize.value != null
    return true
  })

  const { term, connected, connect, disconnect, refit, send, isLive } = useLiveTerminal(
    termEl,
    termUrlRef,
    adoptSize,
  )
  const { screen, suggest } = useScreen(term)
  const {
    events,
    connected: jsonlConnected,
    resolvedPath,
    hasMoreOlder,
    loadingOlder,
    loadOlder,
    reconnect: jsonlReconnect,
  } = useJsonl(jsonlSrcRef)
  // /term WS 断开(含心跳判死的半开)时屏是冻帧,不可信 —— 给空屏让 sessionStatus 落回 jsonl
  // 尾部推断,否则旧 busy 帧的「esc to interrupt」会把状态钉死在生成中。
  const state = computed(() =>
    sessionStatus(events.value, connected.value ? screen.value : [], suggest.value),
  )

  // readInput:输入框真实内容,减掉建议鬼影(空输入只剩建议时返回 '')。
  const readInput = () => {
    const box = extractInputBox(screen.value).trim()
    const sg = suggest.value.trim()
    if (!sg) return box
    if (box === sg) return ''
    if (box.endsWith(sg)) return box.slice(0, box.length - sg.length).trim()
    return box
  }
  const getEvents = () => events.value
  const getScreen = () => screen.value

  function reconnect() {
    disconnect()
    if (canConnect.value) connect()
  }
  // 选中会话变 或 连接闸翻转(切模式 / chat 态尺寸刚拿到)→ 重连或断开。
  watch([sel, canConnect], reconnect)
  watch(
    sessions,
    (list) => {
      if (!selSid.value && list.length)
        selSid.value = (list.find((s) => s.live) ?? list[0]).session_id
    },
    { immediate: true },
  )
  // /clear 跟随:同一 tmux pane 内 /clear 把会话滚到新的 jsonl 文件时,服务端 /sse/jsonl 跟 pane 走、
  // 发 switched meta,useJsonl 把 resolvedPath 切到 <新 session>.jsonl。这里把 selSid 跟到该新 id →
  // Workspace 的 watch(selSid) 同步 hub URL 到 /d/<device>/<新 session>,列表选中 / term / jsonl 也一致。
  // 用 jsonl 流的真信号,而非靠 /sessions 列表判「旧会话 live→dead + 同 pane 接棒」——后者实测不成立:
  // /clear 后旧会话已不在任何 pane,其 tmux 为空,接棒条件永不满足,故从不跳。
  // 不会误跳:看历史 dead 会话时其 jsonl 不滚动,resolvedPath 恒 = selSid → no-op;主动切会话时
  // open() 先把 resolvedPath 同步清 ''(见 useJsonl.open)→ 不会用旧路径回退掉刚选的新会话。
  watch(resolvedPath, (p) => {
    const id = /([^/]+)\.jsonl$/.exec(p || '')?.[1]
    if (id && id !== selSid.value) {
      // 记下 /clear 来源会话:新会话首屏由 Transcript 读 'ccfly:prev:<新sid>' 显示「由 X 跳转而来」。
      const old = selSid.value
      if (old) {
        try {
          const title = sessions.value.find((s) => s.session_id === old)?.title || ''
          localStorage.setItem('ccfly:prev:' + id, JSON.stringify({ sid: old, title }))
        } catch {
          /* 配额/隐私模式:忽略 */
        }
      }
      selSid.value = id
    }
  })
  // paneSid — 当前流锚定的 pane 正跑着哪个 sid(从 resolvedPath 解析)。用于区分「/clear 跟随」与「主动切会话」。
  const paneSid = computed(() => /([^/]+)\.jsonl$/.exec(resolvedPath.value || '')?.[1] || '')
  // 锁定锚:/sessions 一报出选中会话的真实(稳定)pane 名就锁住 anchor;此后 /clear 换 sid 不再动目标 → 不重连。
  watch(
    () => selMeta.value?.tmux,
    (t) => {
      if (t && !anchor.value) anchor.value = t
    },
  )
  // 主动切到「别的会话」(选中的 sid ≠ 当前 pane 正跑的那个)→ 解锁 anchor,让新会话重新起锚。
  // /clear 跟随时 selSid 跟到的正是 paneSid(同一 pane),sid === paneSid → 不解锁、目标不变 → 不重连。
  watch(selSid, (sid) => {
    if (sid && sid !== paneSid.value) anchor.value = ''
  })
  watch(mode, () => refit()) // 切 term↔chat 且无需重连时:仍 refit 让 xterm 采用新尺寸策略(fit↔adopt)

  // 自动重连(取代手动按钮)。移动端切到别的 App / 锁屏后,WebSocket 常被系统挂起/关闭,但 onclose 可能不触发,
  // connected 仍滞后为 true(状态点还绿)。所以回前台/网络恢复时**强制重连**(不看 connected),别信任旧状态。
  function reconnectAll(): void {
    // 不卡 canConnect:chat 态拿不到尺寸(canConnect=false)正是「重连不动」的常见原因。
    // 刷新 /sessions 让 cols/rows、live 变化流进来 —— canConnect 翻转后 watch 会自动 connect。
    void refreshSessions()
    jsonlReconnect() // jsonl SSE
    if (canConnect.value) reconnect() // /term WS
  }
  function onVisible(): void {
    if (document.visibilityState === 'visible') reconnectAll()
  }
  // ensureLive — 发送前调用:用 WS 真实 readyState 判断(isLive),而非滞后的 connected。
  // socket 真死(移动端后台回来常见)→ 重连并等握手(最多 ~3s),避免往死 socket 盲发丢消息。
  async function ensureLive(): Promise<void> {
    if (!canConnect.value || isLive()) return
    reconnect()
    for (let i = 0; i < 30 && !isLive(); i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  onMounted(() => {
    window.addEventListener('resize', refit)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', reconnectAll)
    if (canConnect.value) connect() // 深链/初始已选 → 立即连(watch 接不住初始值)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', refit)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', reconnectAll)
  })

  return {
    sessions,
    selSid,
    sel,
    term,
    connected,
    jsonlConnected,
    termless,
    resolvedPath,
    events,
    screen,
    suggest,
    state,
    send,
    ensureLive,
    readInput,
    getEvents,
    getScreen,
    reconnect,
    reconnectAll,
    takeover,
    refit,
    hasMoreOlder,
    loadingOlder,
    loadOlder,
  }
}
