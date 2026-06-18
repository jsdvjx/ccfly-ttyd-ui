// useJsonl — 经 SSE 把一个 session 的 jsonl 增量收成响应式 events 数组,并做本地持久化:
//   - 打开会话:先读 IndexedDB 缓存,连 SSE 时带 ?since=<offset>&sincePath=<path>。
//   - 服务端若确认同一文件(meta.fresh===false)→ 只发 offset 之后的增量,前端用缓存做基底秒级渲染;
//     否则(换文件/老服务端/首次)→ 从头发,前端清空重收。
//   - 收流时按字节 offset(SSE id)记录进度,防抖写回 IndexedDB;切会话/卸载时也落一次。
// src 取值:'' = 不连;'session:<tmux名>' = 该会话当前主线 jsonl;其它 = 绝对路径。
import { shallowRef, ref, watch, triggerRef, onUnmounted, type Ref } from 'vue'
import type { JEvent } from '../state'
import { sseUrl, httpUrl } from '../config'
import { loadCache, saveCache, type JsonlCache } from '../idb'

const KEEP = 10000 // 写缓存时保留的尾部条数上限(内存不再裁剪:首拉即按 ?tail 限窗)
const TAIL = 200 // 「最新优先」首拉的尾窗行数(冷开;暖开走 since 续传不带 tail)

// memCache — 模块级内存快照(键 = src),跨 Workspace 重挂存活。冷开时**同步**命中即秒铺对话,
// 零异步、零空屏 —— 这是「从列表进会话 / 再次进入刚看过的会话」不再每次先闪一帧空白的关键
// (IndexedDB 是异步的,单靠它每次进入都会先空一帧)。persist() 同步写它 + 异步写 IDB(IDB 管跨刷新)。
const memCache = new Map<string, JsonlCache>()

// srcPrefix — src('session:<名>' 或 绝对路径)→ 查询前缀(/sse/jsonl 与 /jsonl/before 共用,避免漂移)。
function srcPrefix(src: string): string {
  const s = src.trim()
  return s.startsWith('session:')
    ? '?session=' + encodeURIComponent(s.slice('session:'.length))
    : '?path=' + encodeURIComponent(s)
}

// buildQuery — 续传(同文件、有 offset)→ 带 since/sincePath 只拉增量;否则冷开 → tail 尾窗。
// tail 恒带:续传时服务端忽略它;若服务端做了「follow 愈合重定向」(换文件,since 作废),
// 它就是新文件的尾窗兜底,避免重定向后全量从头发。
// follow=1 = 「我在跟随这条流(断线重开),不是用户主动点开历史」:服务端据此允许把已死
// 旧 sid 愈合到原 pane 的当前会话(/clear 发生在断线窗口时的跟跳补救);主动浏览历史不带,
// 保证读历史绝不被跳走。
function buildQuery(src: string, since: number, sincePath: string, follow: boolean): string {
  let q = srcPrefix(src)
  if (since > 0 && sincePath) {
    q += '&since=' + since + '&sincePath=' + encodeURIComponent(sincePath)
  }
  q += '&tail=' + TAIL
  if (follow) q += '&follow=1'
  return q
}

export function useJsonl(src: Ref<string>) {
  // shallowRef:events 是高频 SSE 追加的大数组,不深代理;push 后手动 triggerRef 触发依赖。
  const events = shallowRef<JEvent[]>([])
  const connected = ref(false)
  const resolvedPath = ref('')
  const hasMoreOlder = ref(false) // 当前最旧之上是否还有更老(可向上翻页)
  const loadingOlder = ref(false)
  let es: EventSource | null = null

  let cacheKey = '' // 当前会话的缓存键(= src)
  let curPath = '' // 当前真实 jsonl 路径(来自 meta;写缓存用)
  let offset = 0 // 已收到的末尾字节 offset(= 最后一条 SSE id)
  let headStart = 0 // 当前最旧已加载行的「行首」字节;向上翻页用 /jsonl/before?before=headStart
  let firstMeta = true // 区分「本次 open 的首个 meta」与断线重连/换文件的 meta
  let saveTimer = 0
  let gen = 0 // 异步竞态护栏:open 期间又切了会话则作废
  let reopenDelay = 1500 // CLOSED 兜底重开的退避:成功 open 复位,失败翻倍封顶 30s(防服务端不在时 1.5s 一发打满网关)

  function persist() {
    if (cacheKey && curPath) {
      // headStart 仅在「缓存了内存全集」(≤KEEP)时才有效:此时缓存最旧 = 内存最旧;
      // 否则缓存只存了尾部子集,其最旧行行首未知 → 存 0(暖开时该会话暂不可向上翻,冷开重窗后恢复)。
      const hs = events.value.length <= KEEP ? headStart : 0
      const snap: JsonlCache = {
        path: curPath,
        offset,
        events: events.value.slice(-KEEP),
        headStart: hs,
      }
      memCache.set(cacheKey, snap) // 同步内存镜像:再次进入秒开、零空屏(见 open 的内存命中分支)
      void saveCache(cacheKey, snap) // IndexedDB:跨刷新 / 重开
    }
  }
  function scheduleSave() {
    if (saveTimer) return
    // 流式追赶时不频繁写;静默 1.5s 后落一次(追赶中持续来包则一直推迟,直到稳定)。
    saveTimer = window.setTimeout(() => {
      saveTimer = 0
      persist()
    }, 1500)
  }

  // wire — 给当前 es 挂 meta/onopen/onerror/onmessage。base = 续传基底(冷开 = IndexedDB 缓存;
  // 暖重连 = 当前内存快照)。服务端确认同文件(meta.fresh===false)就用 base 秒级铺底,否则清空从头收。
  function wire(base: JsonlCache | null) {
    if (!es) return
    es.addEventListener('meta', (e) => {
      try {
        const m = JSON.parse((e as MessageEvent).data) as {
          path?: string
          fresh?: boolean
          switched?: boolean
          headStart?: number
          hasMore?: boolean
        }
        if (m.path) {
          resolvedPath.value = m.path
          curPath = m.path
        }
        if (firstMeta) {
          firstMeta = false
          // 服务端明确确认续传(同文件)→ 用 base 做基底,随后只追加增量。
          // 暖重连时 base.events === 当前 events(同引用),这步是 no-op,屏幕不闪、滚动不跳。
          if (m.fresh === false && base && base.events.length) {
            events.value = base.events as JEvent[]
            offset = base.offset
            // 续传时服务端不给尾窗 headStart → 用 base 持久化的 headStart(缺省=未知=不可向上翻)。
            headStart = base.headStart ?? 0
            hasMoreOlder.value = headStart > 0
            triggerRef(events)
          } else {
            // fresh / 老服务端无该字段 / 无基底 → 从头(或尾窗)收,清空(防与全量重发重复)。
            events.value = []
            offset = 0
            headStart = m.headStart ?? 0
            hasMoreOlder.value = !!m.hasMore
            triggerRef(events)
          }
        } else if (m.switched) {
          // 流中途换了文件(/clear、冷启动)→ 旧内容作废,清空从新文件头收。
          events.value = []
          offset = 0
          headStart = m.headStart ?? 0
          hasMoreOlder.value = !!m.hasMore
          triggerRef(events)
        }
      } catch {
        /* ignore */
      }
    })
    es.onopen = () => {
      connected.value = true
      reopenDelay = 1500
    }
    es.onerror = () => {
      connected.value = false // 网络断:浏览器自动重连(带 Last-Event-ID 续传)
      // 但响应非 200(如 /clear 跟跳瞬间服务端短暂 404)时 EventSource 直接 CLOSED、**永不重试**,
      // 流就死了(对话从此空白)→ 兜底:延时整体重开;期间切了会话(gen 变)则作废。
      if (es?.readyState === EventSource.CLOSED) {
        const g = gen
        const d = reopenDelay
        reopenDelay = Math.min(reopenDelay * 2, 30000)
        setTimeout(() => {
          if (g === gen) void open(true) // 跟随中的重开:带 follow,允许服务端愈合跟跳
        }, d)
      }
    }
    es.onmessage = (e) => {
      try {
        events.value.push(JSON.parse(e.data))
        const n = parseInt(e.lastEventId, 10) // SSE id = 该行末尾字节 offset
        if (!Number.isNaN(n)) offset = n
        // 不再裁剪内存头部:首拉已按 ?tail 限窗,增量只在尾部追加;裁头会使 headStart 失真、毁掉向上翻页。
        triggerRef(events)
        scheduleSave()
      } catch {
        /* 非 JSON:跳过 */
      }
    }
  }

  // follow=true:本次是「跟随中的重开」(断流兜底/外部 reconnect),非用户主动切会话 —— 见 buildQuery。
  async function open(follow = false) {
    es?.close()
    es = null
    connected.value = false
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = 0
    }
    const myGen = ++gen
    const s = src.value.trim()

    // 暖重连:同一会话 + 跟随式重开(回前台 / 网络恢复)+ 内存已有事件 → **不清屏**。保留当前对话与游标,
    // 从当前 offset 续 SSE 只拉增量;仅当服务端确认换了文件(meta.switched / fresh≠false)才清空重收。
    // 修掉「每次回前台对话闪空→秒回」的大跳:reconnectAll → jsonlReconnect 旧实现无条件清空 events。
    if (follow && s && s === cacheKey && curPath && events.value.length > 0) {
      firstMeta = true
      const base: JsonlCache = { path: curPath, offset, events: events.value, headStart }
      es = new EventSource(sseUrl(buildQuery(s, offset, curPath, true)))
      wire(base)
      return
    }

    // 冷开(首连 / 用户切会话 / 从列表进会话):先**同步**查内存快照 → 命中即秒铺(零空屏);
    // 未命中再读 IndexedDB(跨刷新兜底);都没有才空屏等 SSE。命中的那份即作 SSE 续传基底。
    cacheKey = s
    loadingOlder.value = false
    firstMeta = true
    const mem = s ? memCache.get(s) : undefined
    let base: JsonlCache | null = null
    if (mem && mem.events.length) {
      // 同步铺底:复制事件数组,隔离 memCache 快照(SSE 续传往 events 里 push 不污染下次命中)。
      events.value = mem.events.slice() as JEvent[]
      offset = mem.offset
      curPath = mem.path
      headStart = mem.headStart ?? 0
      resolvedPath.value = mem.path
      base = { path: curPath, offset, events: events.value, headStart }
    } else {
      events.value = []
      offset = 0
      curPath = ''
      headStart = 0
      resolvedPath.value = ''
    }
    hasMoreOlder.value = headStart > 0
    triggerRef(events)
    if (!s) return // 未选会话:不连

    // 内存未命中 → 读 IndexedDB(异步;期间又切了会话则作废)。命中即铺底,作续传基底。
    if (!base) {
      const cached: JsonlCache | null = await loadCache(s)
      if (myGen !== gen) return
      if (cached && cached.events.length) {
        events.value = cached.events as JEvent[]
        offset = cached.offset
        curPath = cached.path
        headStart = cached.headStart ?? 0
        hasMoreOlder.value = headStart > 0
        resolvedPath.value = cached.path
        triggerRef(events)
        base = cached
      }
    }
    // 连 SSE:有基底就带 since/sincePath 只拉增量;首个 meta 决定沿用基底(同文件 = no-op)或清空重收。
    es = new EventSource(sseUrl(buildQuery(s, offset, curPath, follow)))
    wire(base)
  }

  // loadOlder — 向上翻页:取 headStart 字节之前的一窗更老原始行,prepend 到 events 头部。
  // 不裁剪、不动 offset(尾部续传游标);headStart 前移到本批最旧行行首,hasMoreOlder 据服务端更新。
  async function loadOlder() {
    if (loadingOlder.value || !hasMoreOlder.value || headStart <= 0 || !cacheKey) return
    loadingOlder.value = true
    const myGen = gen
    try {
      const url = httpUrl('/jsonl/before' + srcPrefix(cacheKey) + '&before=' + headStart)
      const r = await fetch(url, { credentials: 'same-origin' })
      if (!r.ok) {
        hasMoreOlder.value = false
        return
      }
      const d = (await r.json()) as { lines?: string[]; firstStart?: number; hasMore?: boolean }
      if (myGen !== gen) return // 翻页途中切了会话:作废
      const older: JEvent[] = []
      for (const ln of d.lines ?? []) {
        try {
          older.push(JSON.parse(ln) as JEvent)
        } catch {
          /* 非 JSON:跳过 */
        }
      }
      if (older.length) {
        events.value = [...older, ...events.value]
        headStart = d.firstStart ?? 0
        hasMoreOlder.value = !!d.hasMore && headStart > 0
        triggerRef(events)
        scheduleSave()
      } else {
        hasMoreOlder.value = false
      }
    } catch {
      /* 网络失败:静默,下次再试 */
    } finally {
      loadingOlder.value = false
    }
  }

  // 注意不可 watch(src, open):watch 会把 (新值, 旧值) 传给回调,新值(字符串)会被当成 follow=true。
  // 用户主动切会话必须是「非跟随」打开(死会话按历史静态渲染,不愈合跳走)。
  watch(src, () => void open())
  void open()
  onUnmounted(() => {
    es?.close()
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = 0
    }
    persist() // 卸载前落一次,别丢最后一段进度
  })

  // reconnect(外部:回前台/网络恢复时调)= 跟随中的重开 → 带 follow,断线窗口里错过的 /clear 在此愈合。
  return {
    events,
    connected,
    resolvedPath,
    hasMoreOlder,
    loadingOlder,
    loadOlder,
    reconnect: () => void open(true),
  }
}
