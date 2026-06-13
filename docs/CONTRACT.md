# 传输契约(CONTRACT.md)

本项目 `ccfly-ttyd-ui` 是**传输无关**的前端。它只依赖:① 下面这套契约;② 一个 `base` 配置
(见 `src/config.ts`)。同一份构建产物可被两处托管:

- **本地 ccfly(Go 二进制)**:同源(`base=''`),`go:embed` 吐 UI + 本地实现下列端点。
- **cc.hn(云 hub)**:`configure({ base: '/x/<device>' })` 指向某设备,hub 经 mesh 把契约反代到该节点。

## 运行时模式自适应(同一份产物,两处 embed)

`src/App.vue` 启动时探测 `GET /api/me` 区分两种宿主,无需两套构建:

| 探测结果               | 宿主           | 行为                                                                               |
| ---------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `200` + JSON `{owner}` | cc.hn 已登录   | `src/hub/` 外壳:设备列表 → 选设备 `configure({base:'/x/<id>'})` → 挂 `Workspace`。 |
| `401`                  | cc.hn 未登录   | `Login`(`/api/providers` + `/auth/<p>/login`);深链 `/link/<id>` 先暂存再跳登录。   |
| `200` HTML / 网络错    | 节点(SPA 回退) | `base=''` 直接挂 `Workspace`(本机单节点)。                                         |

cc.hn 侧用到的 hub 控制面端点(由 cc.hn 提供,非本契约):`/api/me`、`/api/providers`、`/api/devices`
(GET/POST/DELETE)、`/api/pair/{id}`(GET/approve/deny)、`/auth/{provider}/login`、`/auth/logout`。
**节点的三条契约端点(下文)在 hub 模式下一律带 `/x/<device>` 前缀经网关代理**(`/x` 在 cc.hn 的
service-worker BYPASS 名单里,流式不被缓存)。

## 职责边界

| 谁                | 负责                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **ccfly-ttyd-ui** | 表世界全部业务:screen→struct、控件映射、transcript 渲染、确认式发送。只认契约 + base。                                             |
| **ccfly(Go)**     | 本地实现契约(`/term` 自带 ttyd、`/sse/jsonl`、`/sessions`)、tmux/PTY、mesh 远程、go:embed UI、多平台分发。**不做 screen→struct**。 |
| **cc.hn**         | 经 mesh 把契约代理到目标节点;托管 UI 并注入指向节点的 `base`。                                                                     |

> `server/`(jsonlReader / ssePlugin / watch)是本项目的**开发态参考实现**,让 UI 能脱离 Go 独立 `npm run dev`;非运行时依赖。生产由 Go/hub 按本契约实现。

## 端点

所有路径相对 `base`。`{session}` = tmux 会话名(如 `cc-<sid8>`);服务端负责把它解析到真正在跑的 tmux/jsonl(`/clear` 后仍对得上)。

### 1. `GET {base}/term?session=<s>[&cwd=&cmd=]` — 终端(ttyd WS)

- 升级为 WebSocket(子协议 `tty`);ttyd 1.7.x 帧协议。
- 首帧(client→server):无前缀 JSON `{AuthToken, columns, rows}`。
- client→server:`'0'`+bytes = INPUT;`'1'`+JSON `{columns,rows}` = RESIZE。
- server→client:`'0'`+bytes = OUTPUT;`'1'` = title;`'2'` = prefs。
- 语义:`tmux new -A -s <session>` —— 同名在跑则 attach 镜像。UI 据此镜像屏幕 + 走 INPUT 轨发送。

### 2. `GET {base}/sse/jsonl?session=<s>` 或 `?path=<abs>` — jsonl 增量流(SSE)

- `Content-Type: text/event-stream`。
- 每条:`id: <字节offset>` + `data: <一行原始 jsonl>`;另发 `event: meta` `data: {path[,switched]}`。
- `id` = 该行末尾字节 offset → 浏览器断线自动带 `Last-Event-ID` 续传。
- **必须跟随会话当前文件**:claude 冷启动/`/clear` 会换 jsonl,服务端要重解析并切到新文件(否则 `/context` 这类靠 jsonl 取结果的命令超时)。
- `?path` 必须限定在 `~/.claude/projects` 下(防任意文件读取)。

### 3. `GET {base}/sessions` — 会话列表

- JSON 数组,每项含:会话名、cwd、gitBranch、是否 live、(可选)claude 版本。UI 据此渲染会话列表并选择 `session`。

## 版本与扩展

- 契约变更走显式版本(如 `/v1/term`)或能力协商;UI 与服务端各自声明支持的版本。
- 新端点(附件上传、子代理控制等)按需加入本文件,保持 UI ↔ 服务端单一事实来源。
