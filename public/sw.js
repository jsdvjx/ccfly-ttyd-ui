// ccfly PWA service worker —— 只让「可安装 + app shell 离线秒开」,绝不碰实时数据。
//
// 关键约束:本应用本质是在线控制台(控制远端设备),实时数据全走这些前缀,SW 一律直通网络、
// 不拦不缓。Hub 侧走 /api(REST)、/x(设备网关,含 SSE/WS 流式)、/auth(OAuth)、/mesh、/connect、
// /healthz;节点直连侧走契约端点 /sse(jsonl SSE)、/term(WS)、/sessions、/transcript、/state。
// SW 只缓存「壳」:导航返回的 index.html + 内容哈希的 /assets/*(不可变)+ 图标/manifest。
// v2:换 Vue 双模前端 + 扩 BYPASS(加节点契约端点);activate 会清掉 v1 旧壳缓存。
const SHELL = 'ccfly-shell-v4'

// 直通名单:这些前缀的请求一律不经 SW(直接走网络),避免缓存实时/认证响应或破坏流式。
const BYPASS = [
  /^\/api\//,
  /^\/x\//,
  /^\/auth\//,
  /^\/mesh\b/,
  /^\/connect\b/,
  /^\/healthz\b/,
  /^\/sse\b/,
  /^\/term\b/,
  /^\/sessions\b/,
  /^\/transcript\b/,
  /^\/state\b/,
  /^\/sw\.js$/, // SW 绝不缓存自身脚本(否则更新检查可能被旧副本满足)
]

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(SHELL).then((c) => c.add('/'))) // 预存 app shell(SPA 兜底 index)
})

self.addEventListener('activate', (e) => {
  // 清掉旧版本缓存,接管现有页面。
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // 跨域(如跳 GitHub OAuth)不管
  if (BYPASS.some((re) => re.test(url.pathname))) return // 实时/认证接口直通,SW 不介入

  // 导航请求:网络优先(始终拿最新 index),离线时回退缓存的 app shell。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('/', copy)) // 顺手刷新壳
          return res
        })
        .catch(() => caches.match('/', { ignoreSearch: true }).then((r) => r || Response.error())),
    )
    return
  }

  // 同源静态资源(/assets/* 内容哈希不可变、图标、manifest):缓存优先,miss 取网络并回填。
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(SHELL).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
