import { watch, readdirSync, statSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, sep } from 'node:path'
import { homedir } from 'node:os'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createJsonlReader } from './jsonlReader.ts'

// jsonlSse — 一个 Vite 开发中间件:GET /sse/jsonl[?path=<abs>] 把 jsonl 以 SSE 增量推给浏览器。
//   - id = 字节 offset → 浏览器断线自动带 Last-Event-ID 续传(免费的断点续传)。
//   - 不带 path 时,默认挑 ~/.claude/projects 下最新的 jsonl(方便 demo)。
export function jsonlSse(): Plugin {
  return {
    name: 'jsonl-sse',
    configureServer(server) {
      server.middlewares.use('/sse/jsonl', (req, res) => handle(req, res))
    },
  }
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const u = new URL(req.url ?? '', 'http://localhost')
  const session = u.searchParams.get('session')
  // 显式 ?path 必须落在 ~/.claude/projects 下(realpath 防符号链接/.. 穿越),否则 403:
  // dev 中间件不该变成任意文件读取(`vite dev --host` 下的泄露面)。session/newest 本就在 root 下。
  const explicit = u.searchParams.get('path')
  let path: string | null
  if (explicit) {
    path = confinePath(explicit)
    if (!path) {
      res.statusCode = 403
      res.end('path not allowed')
      return
    }
  } else {
    path = (session ? jsonlForSession(session) : null) || newestJsonl()
  }
  if (!path) {
    res.statusCode = 404
    res.end('no jsonl found')
    return
  }

  // 续传:浏览器重连会带 Last-Event-ID(= 上次最后一条的 offset)。
  const lastId = Number(req.headers['last-event-id'])
  const start = Number.isFinite(lastId) ? lastId : 0

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    // 不写 Connection: keep-alive —— HTTP/2 下非法,Node 自管连接。
  })
  res.write(`retry: 1000\n`)
  res.write(`event: meta\ndata: ${JSON.stringify({ path, start })}\n\n`)

  // safeWatch:文件可能瞬时不存在(/clear、轮转的 TOCTOU)→ watch 会抛、崩 Vite dev。
  // 包一层返回 null,失败由 reresolve/ping 兜底重建。
  const safeWatch = (p: string): ReturnType<typeof watch> | null => {
    try {
      return watch(p, () => void drain())
    } catch {
      return null
    }
  }

  let currentPath = path
  let reader = createJsonlReader(currentPath, start)
  let watcher = safeWatch(currentPath)
  let closed = false

  // drain 并发保护:任意时刻只一个在跑;期间来的触发合并成一次补跑(配合 reader 串行化双保险)。
  let draining = false
  let again = false
  async function drain() {
    if (closed) return
    if (draining) {
      again = true
      return
    }
    draining = true
    try {
      do {
        again = false
        try {
          for (const rec of await reader.read()) {
            res.write(`id: ${rec.offset}\n`)
            res.write(`data: ${rec.line}\n\n`) // 每条 jsonl 是单行 JSON,放一条 data 安全
          }
        } catch {
          /* 文件暂时不可读:跳过,下次 watch/轮询再来 */
        }
      } while (again && !closed)
    } finally {
      draining = false
    }
  }

  void drain() // 存量(或从 start 续上)

  // session 模式:持续跟随会话当前 jsonl。claude 冷启动/`/clear` 会换新文件,connect 那一刻
  // 锁死的旧文件会「跟丢」—— /context 这类靠 jsonl 取结果的命令就永远收不到 → 超时。
  // 定时重解析会话的 jsonl,文件变了就切到新文件继续 tail。
  let reresolve: ReturnType<typeof setInterval> | null = null
  if (session && !u.searchParams.get('path')) {
    reresolve = setInterval(() => {
      if (closed) return
      const np = jsonlForSession(session)
      if (np && np !== currentPath) {
        currentPath = np
        watcher?.close()
        reader = createJsonlReader(np, 0) // 切到新文件,从头发
        watcher = safeWatch(np)
        res.write(`event: meta\ndata: ${JSON.stringify({ path: np, switched: true })}\n\n`)
        void drain()
      }
    }, 1500)
  }

  const ping = setInterval(() => {
    if (!closed) res.write(`: ping\n\n`) // 心跳,防代理掐连接
  }, 15000)

  // 幂等清理,挂 req 与 res 的 close,避免任一侧关闭时泄漏 watcher/interval。
  const cleanup = () => {
    if (closed) return
    closed = true
    watcher?.close()
    clearInterval(ping)
    if (reresolve) clearInterval(reresolve)
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
}

// confinePath — 把显式 path 限定在 ~/.claude/projects 下;不在则返回 null。
function confinePath(p: string): string | null {
  const root = join(homedir(), '.claude', 'projects')
  try {
    const rp = realpathSync(p)
    return rp === root || rp.startsWith(root + sep) ? rp : null
  } catch {
    return null
  }
}

// jsonlForSession — 把 tmux 会话名解析到「它 cwd 下最新的主线 jsonl」(对准正在跑的 claude 会话)。
// 取 pane_current_path → 编码成 project 目录名(非字母数字→-)→ 该目录里 mtime 最新的 <uuid>.jsonl。
function jsonlForSession(name: string): string | null {
  let cwd = ''
  try {
    cwd = execFileSync('tmux', ['display-message', '-p', '-t', name, '#{pane_current_path}'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
  if (!cwd) return null
  const dir = join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  let best: string | null = null
  let bestMs = -1
  try {
    for (const f of readdirSync(dir)) {
      if (!/^[0-9a-f-]{36}\.jsonl$/.test(f)) continue // 只要主线文件(排除 agent-*/journal)
      const p = join(dir, f)
      const ms = statSync(p).mtimeMs
      if (ms > bestMs) {
        bestMs = ms
        best = p
      }
    }
  } catch {
    return null
  }
  return best
}

// newestJsonl — ~/.claude/projects/*/*.jsonl 里 mtime 最新的那个。
function newestJsonl(): string | null {
  const root = join(homedir(), '.claude', 'projects')
  let best: string | null = null
  let bestMs = -1
  let dirs: string[] = []
  try {
    dirs = readdirSync(root)
  } catch {
    return null
  }
  for (const d of dirs) {
    const dir = join(root, d)
    let files: string[] = []
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(dir, f)
      try {
        const ms = statSync(p).mtimeMs
        if (ms > bestMs) {
          bestMs = ms
          best = p
        }
      } catch {
        /* ignore */
      }
    }
  }
  return best
}
