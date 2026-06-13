// useLiveTerminal — 在容器里挂一个 xterm,连 ttyd,双向桥接。返回 term 句柄供读屏。
import { shallowRef, markRaw, ref, watch, onUnmounted, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { connect as ttydConnect, type TtydConn } from '../ttyd'

// size:可选「固定尺寸」。给了非空值 → 终端采用该 cols/rows(不 fit 容器)—— chat 隐藏终端据此**沿用现有
// tmux 窗口尺寸**,不去 resize 系统 tmux。为空(null/undefined)→ 贴合容器(term 可见态的常态)。
export function useLiveTerminal(
  container: Ref<HTMLElement | null>,
  url: Ref<string>,
  size?: Ref<{ cols: number; rows: number } | null>,
) {
  // shallowRef + markRaw:xterm Terminal 是个有内部 WeakMap/identity 的大对象,绝不能被 Vue 深代理。
  const term = shallowRef<Terminal | null>(null)
  const connected = ref(false)
  let fit: FitAddon | null = null
  let conn: TtydConn | null = null
  let ro: ResizeObserver | null = null
  let rafPending = false

  // 输出流 remap:claude /context 网格用 ⛀⛁(draughts)/⛶(square-corners),JetBrains 没这些字形、
  // 多数字体也只把它们画成棋子/方框 → 之前满屏横线/豆腐块。这几个码点只服务该网格,直接在输出里换成
  // JetBrains 自带的实心块,得到干净的方块用量格,零字体依赖。流式 TextDecoder 跨 WS 帧拼合多字节。
  const outDec = new TextDecoder()
  const remapGrid = (s: string): string =>
    s.replace(/⛁/g, '█').replace(/⛀/g, '▓').replace(/⛶/g, '░')

  // refit — 把终端尺寸贴合容器。合并到下一帧执行:
  //   ① 挂载/字体加载/flex 布局未稳时同步 fit 会算出错误 cols/rows(常退化成 80×30);
  //   ② ResizeObserver 在容器尺寸变化时回调,一帧内多次触发只 fit 一次,且不会自激循环
  //      (fit 改的是终端内部尺寸,不改被观察的容器尺寸)。
  function refit() {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      try {
        const s = size?.value
        if (s && s.cols > 0 && s.rows > 0) {
          const t = term.value
          if (t && (t.cols !== s.cols || t.rows !== s.rows)) t.resize(s.cols, s.rows) // 固定尺寸:沿用,不 fit
        } else {
          fit?.fit()
        }
      } catch {
        /* renderer 未就绪:忽略,下次 RO/resize/watch 再来 */
      }
    })
  }

  function ensureTerm() {
    if (term.value || !container.value) return
    const s0 = size?.value
    const t = new Terminal({
      cols: s0?.cols && s0.cols > 0 ? s0.cols : 80,
      rows: s0?.rows && s0.rows > 0 ? s0.rows : 30,
      fontSize: 14, // 对齐本地 ghostty(font-size = 14)
      // Nerd Font 在前(starship/powerline 图标);Ccfly Symbols 补 JetBrains 缺的符号(claude /context 网格);系统等宽兜底。
      fontFamily:
        '"JetBrainsMono Nerd Font Mono", "Ccfly Symbols", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 1000,
      theme: { background: '#0b0e14' },
    })
    fit = new FitAddon()
    t.loadAddon(fit)
    t.open(container.value)
    t.onData((d) => conn?.sendInput(d))
    t.onResize(({ cols, rows }) => conn?.resize(cols, rows))
    term.value = markRaw(t)
    // 容器尺寸定下来(及后续每次变化)→ 贴合。observe 本身会立即回调一次,覆盖初次布局。
    ro = new ResizeObserver(() => refit())
    ro.observe(container.value)
    if (size) watch(size, refit) // 固定尺寸变化(切会话/换窗口)→ 重新采用
    refit()
    ensureFont(t)
  }

  // ensureFont — webfont 异步加载:xterm 创建时按「当时可用的字体(兜底)」量了一次格子宽,等真正的
  // Nerd Font 加载完,格宽会变。故 fonts.load 完成后重赋 fontFamily 触发 xterm 重测格宽/重排,再 fit。
  // (DOM 渲染器下字形本身会随 font-display 自动重画;但格子宽必须重测,否则字形与网格错位。)
  function ensureFont(t: Terminal) {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (!fonts?.load) return
    const fam = '"JetBrainsMono Nerd Font Mono"'
    const rebuild = () => {
      if (term.value !== t) return // 已切换/销毁
      t.options.fontFamily =
        '"JetBrainsMono Nerd Font Mono", "Ccfly Symbols", Menlo, Consolas, monospace'
      refit()
    }
    Promise.all([fonts.load(`13px ${fam}`), fonts.load(`bold 13px ${fam}`)])
      .then(rebuild)
      .catch(() => {})
  }

  function connect() {
    ensureTerm()
    const t = term.value
    if (!t) return
    disconnect()
    // 固定尺寸态(chat):握手前**同步**把 xterm 调到沿用尺寸,使首帧 {columns,rows} = 现有 tmux 窗口尺寸。
    // 否则首帧会用上次(term 态 fit 的)尺寸,经 pty.StartWithSize + tmux window-size=latest **改掉**系统 tmux。
    // (不能依赖 rAF 的 refit:它在握手之后才跑。)
    const s = size?.value
    if (s && s.cols > 0 && s.rows > 0 && (t.cols !== s.cols || t.rows !== s.rows)) {
      t.resize(s.cols, s.rows)
    }
    conn = ttydConnect(url.value, {
      cols: t.cols,
      rows: t.rows,
      onOutput: (bytes) => t.write(remapGrid(outDec.decode(bytes, { stream: true }))),
      onOpen: () => {
        connected.value = true
        refit() // 连上后再贴合一次,并把当前 cols/rows(经 onResize)同步给 PTY
        conn?.resize(t.cols, t.rows)
      },
      onClose: () => {
        connected.value = false
      },
    })
  }

  function disconnect() {
    conn?.close()
    conn = null
    connected.value = false
  }

  // send — 把表世界的输入字节写进 PTY(INPUT 轨)。未连上则丢弃。
  function send(text: string) {
    conn?.sendInput(text)
  }

  // isLive — WS 是否真的 OPEN(读 readyState,非滞后的 connected ref)。
  // 用于发送前判断:移动端后台回来 connected 可能仍为 true 但 socket 已死。
  const isLive = (): boolean => conn?.ready() ?? false

  onUnmounted(() => {
    ro?.disconnect()
    ro = null
    disconnect()
    term.value?.dispose()
  })

  return { term, connected, connect, disconnect, refit, ensureTerm, send, isLive }
}
