// ttyd.ts — 浏览器侧 ttyd / ccfly-/term WebSocket 客户端。
//
// 帧协议(ttyd 1.7.x,ccfly /term 兼容):
//   首帧(client→server):无前缀 JSON 文本 {AuthToken, columns, rows}。
//   client→server:'0'+data = INPUT、'1'+JSON{columns,rows} = RESIZE。
//   server→client:首字节 '0'=OUTPUT(剩余=终端字节)、'1'=SET_WINDOW_TITLE、'2'=SET_PREFERENCES。
//   命令字节是 ASCII '0'/'1'/'2'(0x30/0x31/0x32)。

const CMD = {
  OUTPUT: 0x30,
  TITLE: 0x31,
  INPUT: 0x30,
  RESIZE: 0x31,
  // ccfly 扩展(双向 '9'):client→server PING,server 原样回 PONG。
  // 用于端到端(浏览器→cloud 反代→设备)拒止「半开假活」:WS readyState 还是 OPEN,
  // 但链路任一跳已死 → 输出冻帧、输入黑洞。老设备不认 '9' 会忽略 → 见 pongSeen 门闸。
  PING: 0x39,
} as const

// 心跳节拍 / 判死阈值:每 5s 一 ping;pongSeen 后若 15s(≈3 个 ping)无任何入站帧 → 判半开,杀连接重建。
const HB_INTERVAL = 5000
const HB_DEAD_MS = 15000

export interface TtydHandlers {
  onOutput?: (bytes: Uint8Array) => void
  onTitle?: (title: string) => void
  onOpen?: () => void
  onClose?: () => void
}

export interface TtydConn {
  sendInput: (text: string) => void
  resize: (cols: number, rows: number) => void
  close: () => void
  ready: () => boolean
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function connect(url: string, h: TtydHandlers & { cols?: number; rows?: number }): TtydConn {
  let ws: WebSocket | null = null
  let closed = false
  let handshook = false
  let cols = h.cols ?? 80
  let rows = h.rows ?? 30
  let backoff = 800
  let reTimer = 0
  // 心跳:pongSeen = 服务端曾回过 PONG(支持 '9' 扩展)。只有确认支持才启用「无流量判死」,
  // 否则老设备空闲期没有任何入站帧,会被误杀成重连风暴。lastTraffic = 最近一次收到任意帧的时刻。
  let pongSeen = false
  let lastTraffic = 0
  let hbTimer = 0

  const stopHeartbeat = () => {
    if (hbTimer) {
      clearInterval(hbTimer)
      hbTimer = 0
    }
  }

  // kill — 主动判死:解除该 socket 的回调(死 TCP 上 close 握手可能拖到分钟级才触发 onclose),
  // 立即走与 onclose 相同的善后 + 重连调度。
  const kill = (sock: WebSocket) => {
    sock.onclose = null
    sock.onerror = null
    sock.onmessage = null
    try {
      sock.close()
    } catch {
      /* ignore */
    }
    if (ws === sock) ws = null
    handshook = false
    stopHeartbeat()
    h.onClose?.()
    schedule()
  }

  const startHeartbeat = (sock: WebSocket) => {
    stopHeartbeat()
    lastTraffic = Date.now()
    hbTimer = window.setInterval(() => {
      if (ws !== sock || sock.readyState !== WebSocket.OPEN) return
      if (pongSeen && Date.now() - lastTraffic > HB_DEAD_MS) {
        kill(sock)
        return
      }
      try {
        sock.send(new Uint8Array([CMD.PING]))
      } catch {
        /* ignore */
      }
    }, HB_INTERVAL)
  }

  const sendFirstFrame = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ AuthToken: '', columns: cols, rows }))
    handshook = true
  }

  const open = () => {
    if (closed) return
    let sock: WebSocket
    try {
      sock = new WebSocket(url, 'tty')
    } catch {
      schedule()
      return
    }
    sock.binaryType = 'arraybuffer'
    ws = sock
    handshook = false

    sock.onopen = () => {
      if (closed) {
        try {
          sock.close()
        } catch {
          /* ignore */
        }
        return
      }
      backoff = 800
      sendFirstFrame()
      startHeartbeat(sock)
      h.onOpen?.()
    }

    sock.onmessage = (ev) => {
      lastTraffic = Date.now()
      const d = ev.data
      if (typeof d === 'string') {
        if (d.length === 0) return
        dispatch(d.charCodeAt(0), enc.encode(d.slice(1)))
        return
      }
      const buf = new Uint8Array(d as ArrayBuffer)
      if (buf.length === 0) return
      dispatch(buf[0], buf.subarray(1))
    }

    sock.onclose = () => {
      if (ws === sock) ws = null
      handshook = false
      stopHeartbeat()
      h.onClose?.()
      schedule()
    }
    sock.onerror = () => {
      try {
        sock.close()
      } catch {
        /* ignore */
      }
    }
  }

  function dispatch(cmd: number, rest: Uint8Array) {
    switch (cmd) {
      case CMD.OUTPUT:
        h.onOutput?.(rest)
        break
      case CMD.TITLE:
        h.onTitle?.(dec.decode(rest))
        break
      case CMD.PING: // 服务端回的 PONG:确认链路活 + 服务端支持心跳扩展
        pongSeen = true
        break
      default:
        break // SET_PREFERENCES 等:忽略
    }
  }

  function schedule() {
    if (closed || reTimer) return
    reTimer = window.setTimeout(() => {
      reTimer = 0
      open()
    }, backoff)
    backoff = Math.min(backoff * 1.7, 15000)
  }

  open()

  return {
    sendInput(text: string) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const body = enc.encode(text)
      const out = new Uint8Array(1 + body.length)
      out[0] = CMD.INPUT
      out.set(body, 1)
      ws.send(out)
    },
    resize(c: number, r: number) {
      cols = c
      rows = r
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const body = enc.encode(JSON.stringify({ columns: c, rows: r }))
      const out = new Uint8Array(1 + body.length)
      out[0] = CMD.RESIZE
      out.set(body, 1)
      ws.send(out)
    },
    close() {
      closed = true
      stopHeartbeat()
      if (reTimer) {
        clearTimeout(reTimer)
        reTimer = 0
      }
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        ws = null
      }
    },
    ready() {
      return !!ws && ws.readyState === WebSocket.OPEN && handshook
    },
  }
}
