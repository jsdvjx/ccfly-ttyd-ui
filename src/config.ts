// 传输配置 —— 本 UI 是「传输无关」的:只认契约(/term · /sse/jsonl · /sessions)+ 一个 base。
//
//   本地 ccfly:base 空 = 同源(二进制 go:embed 吐 UI,/term 等同源端点)。
//   cc.hn:host 在启动时 configure({ base: '/x/<node>' } 或 { base: 'https://hub/x/<node>' })
//          指向某个节点;UI 把契约路径拼到 base 后即可远程访问该节点。
//
// 不在 UI 里假设「同源」「被谁托管」—— 换部署只换 base,代码与构建产物不变。

export interface SurfaceConfig {
  /** '' = 同源;相对前缀如 '/x/mac';或绝对 'https://hub/x/mac' / 'wss://hub/x/mac'。 */
  base: string
}

let cfg: SurfaceConfig = { base: '' }

export function configure(c: Partial<SurfaceConfig>): void {
  cfg = { ...cfg, ...c }
}
export function getConfig(): SurfaceConfig {
  return cfg
}

const strip = (s: string): string => s.replace(/\/+$/, '')
const relPrefix = (b: string): string => (b ? (b.startsWith('/') ? strip(b) : '/' + strip(b)) : '')

// httpUrl —— 拼 http(s) 端点(/sse/jsonl、/sessions)。base 空 → 相对同源。
export function httpUrl(path: string): string {
  const b = cfg.base
  if (/^https?:\/\//i.test(b)) return strip(b) + path
  return relPrefix(b) + path
}

// wsUrl —— 拼 ws(s) 端点(/term)。base 空 → 同源 + 跟随页面协议。
export function wsUrl(path: string): string {
  const b = cfg.base
  if (/^wss?:\/\//i.test(b)) return strip(b) + path
  if (/^https?:\/\//i.test(b)) return strip(b).replace(/^http/i, 'ws') + path
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}${relPrefix(b)}${path}`
}

// 契约端点助手
export const sseUrl = (query: string): string => httpUrl('/sse/jsonl' + query)
export const termUrl = (session: string): string =>
  wsUrl('/term?session=' + encodeURIComponent(session))
export const sessionsUrl = (): string => httpUrl('/sessions')
// takeover —— 接管:节点先确定性杀掉该会话既有 claude 进程(防双写),随后由 /term 重建进 tmux。
export const takeoverUrl = (session: string): string =>
  httpUrl('/takeover?session=' + encodeURIComponent(session))

// tmuxName —— claude session id → tmux 会话名(ccfly 约定 cc-<sid[:8]>;服务端再解析 /clear)。
export const tmuxName = (sid: string): string => 'cc-' + sid.slice(0, 8)

// dirsUrl —— 列某路径下的子目录(新建会话的目录浏览器用);path 空 = 设备家目录。
export const dirsUrl = (path: string): string =>
  httpUrl('/dirs' + (path ? '?path=' + encodeURIComponent(path) : ''))
// newSessionUrl —— POST {cwd, permission_mode?, skip_permissions?} 新建会话(detached 起全新 claude),
// 回 {session_id, session}(session_id 是轮询 panemap 拿到的真 sid)。
export const newSessionUrl = (): string => httpUrl('/new')

// uploadUrl —— 图片/文件上传(multipart 字段 file)。?session= 用 tmux 名:服务端据此解析会话
// 冻结 cwd,落盘 <cwd>/.ccfly-uploads/ 并返回绝对路径(供 /sendkeys 的 images 原生附图)。
export const uploadUrl = (session: string): string =>
  httpUrl('/upload?session=' + encodeURIComponent(session))
// sendkeysUrl —— 带图原子提交走 HTTP /sendkeys(clear+text+images+enter):设备端 tmux
// set-buffer + paste-buffer -p 把上传路径括号粘贴进里世界 → 原生 [Image #N],并在 Enter 前
// 轮询确认图已吃进。纯文本仍走 /term WS 的确认式管线(sendMessage),互不相扰。
export const sendkeysUrl = (): string => httpUrl('/sendkeys')

// imageUrl —— 取消息里的图片字节。注意:/image 用「原始 claude session id」(?sid=),不是 tmux 名
// (与 /term、/sse/jsonl?session= 的 cc-<sid8> 不同口径);故 chat 视图必须传 selSid(原始 sid)。
export const imageUrl = (sid: string, uuid: string, idx: number): string =>
  httpUrl(
    '/image?sid=' + encodeURIComponent(sid) + '&uuid=' + encodeURIComponent(uuid) + '&idx=' + idx,
  )
