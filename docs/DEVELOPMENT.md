# ccfly-ttyd-ui 开发规范(DEVELOPMENT.md)

> 面向团队后续深入开发。本文记录架构分层、各层职责与数据流、核心范式、扩展步骤(新增检测器 / 斜杠命令)、命名与目录约定、控制 TUI 的字节原语清单,以及一组**必须遵守的「硬核坑」条款**——这些都是踩出来的,违背它们会直接让功能不可靠。

技术栈:Vue 3 (`<script setup lang="ts">`) + Vite + TypeScript,`@xterm/xterm` + `@xterm/addon-fit`,测试用 `vitest`,e2e 用 `puppeteer-core`(CDP)。

---

## 1. 这个项目在做什么

浏览器连上 ttyd(ccfly 的 `/term` WebSocket)拿到一条**终端字节流**,在浏览器里用 xterm 重建终端网格,然后把屏幕从「像素/字符网格」抽象成**结构化的会话状态**(`screen → struct`),并在此之上做**确认式的输入与斜杠命令**(每一步都验证,失败抛带阶段的错误)。

两路数据进来:

- **screen(实时 UI 控件态)**:从 xterm 网格读出来的当前可见屏。权威反映 idle/busy/各浮层/offline 这类**实时 UI 态**。
- **jsonl(语义/元数据)**:经服务端 SSE 把 claude 会话的 `*.jsonl` 增量推给浏览器。提供 turn / mode / title / error 等**语义信息**。

二者组合出 `SessionState`(见 `src/state/index.ts`)。

---

## 2. 架构与分层

```
ttyd 字节流 ──► src/ttyd.ts ──► useLiveTerminal ──► xterm Terminal
                                                       │
                                  ┌────────────────────┤
                          readScreen / readSuggest    onData/onResize(回写 PTY)
                            (src/screen.ts)
                                  │
                            useScreen ─► screen: string[] / suggest: string
                                  │
   jsonl 文件 ─► server/jsonlReader ─► ssePlugin(/sse/jsonl)─► useJsonl ─► events: JEvent[]
                                  │                                              │
                                  └──────────────┬───────────────────────────────┘
                                                 ▼
                                  sessionStatus(events, screen, suggest)
                                   (src/state/index.ts 组合器)
                                                 ▼
                                            SessionState
                                                 ▼
                              App.vue / StatusPanel / InputBridge / SlashBar
                                                 │
                          sendMessage / sendSlashCommand ─► send() ─► PTY(INPUT 轨)
```

### 分层职责一览

| 层          | 文件                                                                | 职责                                                                                  | 纯度                         |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| 读屏        | `src/screen.ts`                                                     | `readScreen`(纯文本行)/ `readSuggest`(从 cell dim 读建议鬼影)                         | 纯函数,依赖 xterm `Terminal` |
| 状态-检测器 | `src/state/detectors/*`                                             | 每个文件一个独立检测器,**只吃 `string[]` 或 `JEvent[]`,返回布尔/枚举/标量**           | 纯函数,可 fixture 单测       |
| 状态-组合器 | `src/state/index.ts`                                                | `sessionStatus` 把各检测器拼成 `SessionState`;定判定顺序                              | 纯函数                       |
| 状态-契约   | `src/state/types.ts`                                                | `Status` / `JEvent` / `SessionState` 类型(只 import 不改)                             | 类型                         |
| 发送        | `src/send/sendMessage.ts`                                           | 确认式发送(清空→验空→写入→验内容→提交→验 jsonl)                                       | 依赖注入,可 mock             |
| 发送        | `src/send/sendSlashCommand.ts`                                      | 复用 `sendMessage` + resolver 取返回;`fromJsonlStdout` / `fromScreenOverlay` 两个工厂 | 依赖注入                     |
| 发送        | `src/send/commands.ts`                                              | 具体命令:`runContext` / `runUsage`                                                    | —                            |
| 桥接        | `src/ttyd.ts`                                                       | 浏览器侧 ttyd/`/term` WebSocket 客户端(帧协议)                                        | —                            |
| 桥接        | `src/composables/{useLiveTerminal,useScreen,useJsonl}.ts`           | Vue composable,把上面三块接进响应式世界                                               | —                            |
| 桥接        | `src/{App.vue,components/*}`                                        | UI 装配:StatusPanel / InputBridge / SlashBar                                          | —                            |
| 服务端      | `server/{jsonlReader,ssePlugin,watch,state-check}.ts`               | Vite 中间件:读 jsonl、SSE 推送(会话跟随)、CLI 校验                                    | Node                         |
| 测试        | `test/*.test.ts`(当前 274 通过)                                     | 检测器/发送/组合器单测                                                                | —                            |
| fixture     | `test/fixtures/screen`(真实抓屏)、`test/fixtures/jsonl`(脱敏真实行) | —                                                                                     | —                            |

---

## 3. 各层职责与数据流(细节)

### 3.1 桥接:ttyd / `/term` 帧协议(`src/ttyd.ts`)

`connect(url, handlers)` 返回 `TtydConn`(`sendInput` / `resize` / `close` / `ready`)。帧协议(ttyd 1.7.x,ccfly `/term` 兼容):

- 首帧(client→server):无前缀 JSON 文本 `{AuthToken, columns, rows}`。
- client→server:`'0'+data` = INPUT,`'1'+JSON{columns,rows}` = RESIZE。
- server→client:首字节 `'0'`=OUTPUT(剩余=终端字节)、`'1'`=SET_WINDOW_TITLE、`'2'`=SET_PREFERENCES(忽略)。
- 命令字节是 ASCII `'0'/'1'/'2'`(`0x30/0x31/0x32`)。

内置指数退避自动重连(`backoff` 800ms → ×1.7 → 上限 15s)。`ready()` 要求 WS OPEN **且** 已握手。

### 3.2 桥接:composable

- `useLiveTerminal(container, url)`:挂 xterm(80×30,`allowProposedApi: true`,`scrollback: 1000`),连 ttyd 双向桥接。返回 `term`(读屏用)、`connected`、`connect/disconnect/refit/ensureTerm`、`send`(把字节写进 INPUT 轨)。
- `useScreen(term, intervalMs=50)`:固定 50ms 节拍循环 `readScreen` + `readSuggest`,产出响应式 `screen` / `suggest`。
- `useJsonl(src)`:经 `EventSource('/sse/jsonl' + query)` 把 jsonl 增量收成响应式 `events`。`src` 取值:`''`=服务端挑最新;`'session:<tmux名>'`=该会话当前主线 jsonl;其它=绝对路径(`buildQuery` 负责拼)。自带断线重连(SSE 带 `Last-Event-ID` 续传)。

### 3.3 读屏层(`src/screen.ts`)

- `readScreen(term): string[]`——当前可见屏快照,逐行 `translateToString(true)`(尾部空白 trim)。无状态。**所有 screen 检测器吃的就是它的输出。**
- `readSuggest(term): string`——空输入时 claude 显示的**暗色建议鬼影**。纯文本分不出暗色,**必须读 cell 的 `isDim()`**:在 `❯` 输入行上收集 dim 字符即建议(还要把压在光标下、被 `isInverse()` 的首字并回)。没建议返回 `''`。

> 为什么 suggest 要单独存在:① 暴露为基础信息;② 让「输入框是否为空」能减掉这段鬼影。`App.vue` 的 `readInput()` 就是用 `extractInputBox(screen) - suggest` 算出输入框真实内容——否则 `sendMessage` 清空验证会把鬼影当残留内容而误判失败(见第 7 节坑 #5)。

### 3.4 状态层

- **检测器**(`detectors/*`):每个状态一个文件、一个纯函数。screen 族吃 `string[]`,jsonl 族(`jsonl.ts`)吃 `JEvent[]`。
- **组合器**(`index.ts` 的 `sessionStatus`):见下方判定顺序。
- **契约**(`types.ts`):`Status` 联合类型、`JEvent`(只声明判断用到的字段,其余 `[k: string]: unknown` 放宽)、`SessionState`。

`sessionStatus(events, screen, suggest='')` 的判定顺序(**顺序即优先级,改动需谨慎**):

```
1) select  → 'select'
2) usage   → 'usage'          // /cost 与 /usage 同一个面板
3) help    → 'help'
4) status  → 'status'
5) config  → 'config'
6) stats   → 'stats'
7) mcp     → 'mcp'
8) plugin  → 'plugin'
9) busy    → detectTurn(events)==='awaiting-tool' ? 'awaiting-tool' : 'generating'
10) idle   → 'idle'
11) offline → 'offline'       // 放最后:所有已知 claude 屏都不中 + 末尾窗口有 shell 证据
12) 其余    → 'unknown'        // 兜底
```

顶层 `status` 全程**屏判**(`source` 固定 `'screen'`);jsonl 只负责 busy 的子类型(awaiting-tool vs generating)+ 全部语义元数据(`mode` / `permissionMode` / `title` / `pending` / `interrupted` / `apiError` / `lastActivity`)。

### 3.5 发送层

详见第 4 节核心范式。

### 3.6 服务端(Vite 中间件)

- `jsonlReader.ts`:`createJsonlReader(path, startOffset)`——append-only 文件的增量切行器。只做「把字节切成 `(offset, line)`」,**不做 `JSON.parse`**(那是下游的事)。文件变小自动从头重读(轮转/压缩)。`offset` 即 SSE 的 `Last-Event-ID`(免费断点续传)。
- `ssePlugin.ts`:`jsonlSse()` 注册 `GET /sse/jsonl` 中间件。支持 `?path=<abs>` / `?session=<tmux名>` / 不带参(挑最新)。**`session` 模式每 1.5s 重解析会话当前 jsonl,文件换了就切到新文件继续 tail**(见坑 #8)。`jsonlForSession` 把 tmux 会话名 → `pane_current_path` → project 目录名 → 目录里 mtime 最新的 `<uuid>.jsonl`(只要主线文件,排除 `agent-*`)。
- `watch.ts`:CLI,`node server/watch.ts <jsonl-path>`,打印每行 `offset + type`。调试用。
- `state-check.ts`:CLI,`node server/state-check.ts`,用真实 `~/.claude/projects` 数据跑 `sessionStatus` / 各检测器,看分布与端到端结果。改检测器后用它对真实数据回归。

---

## 4. 核心范式(必须照搬,不要另起炉灶)

### 4.1 detector 纯函数模式

每个检测器:**一个文件、一个 `detectXxx(lines: string[]): boolean`(或返回枚举/标量),只读输入、无副作用、无状态。**

- 用「面板里稳定出现的**内容特征锚点**」(footer 文案 / 字段标签 / 标题),**不要依赖会随消息滚出视口的孤立文案**(如 `"Esc to cancel"`)。
- 扫**末尾窗口**(`lines.slice(-TAIL)`)而非最后一行,给 tmux 状态栏留余量(坑 #13)。`TAIL` 按面板形态取值(busy=10,idle/select/usage=12/30,status=24…)。
- 锚点要足够唯一,必要时**要求多锚点同时命中**(`detectHelp` 要 ≥2 命中)或叠加硬约束(`detectSelect` 要 footer + 连号编号菜单 + `❯` 当前项三要素同时成立)。
- 文件头写清楚:**语义 + 为什么选这些锚点 + 为什么能排除相邻面板**。现有检测器都这么写,照做。

jsonl 族(`jsonl.ts`)同理,但锚点是「事件 `type` + 字段」这种结构化特征。注意 `detectTurn` 看「尾部最后一条非 meta 内容行」推断 turn(事件落盘后才可见,流式/工具执行时尾部停在上一条)。

### 4.2 组合器模式

`sessionStatus` 是唯一把检测器拼起来的地方。新增状态时**只在这里插一条 `else if`**,并放到正确的优先级位置(浮层在前、busy/idle 居中、offline 倒数第二、unknown 兜底)。不要在检测器之间互相调用(`runUsage` 里组合 `detectUsage && !detectIdle` 是 resolver 的事,不算检测器互调)。

### 4.3 确认式发送 `sendMessage`(`src/send/sendMessage.ts`)

对「往 PTY 发字节」抽象一层,**每一步用最权威的源验证**,失败抛带阶段的 `SendError`:

1. **clear**:分帧逐发清空键(`\x01\x0b\x7f`,每帧间隔 10ms,重复 `CLEAR_FRAMES=24` 次)→ 读屏(`readInput`)确认输入框已空。
2. **type**:`bracketed paste`(`\x1b[200~…\x1b[201~`)整段写入 → 读屏确认 `inputMatches`(单行精确;多行被折叠成 `[Pasted text]` chip 时做结构性确认)。
3. **submit**(可选,`submit:false` 则只到 type):回车 `\r` → **读 jsonl** 确认出现匹配的真实 user 消息(`findUserEvent`,jsonl 是权威:真发出去了)。

依赖以函数注入(`send` / `readInput` / `events` / 可选 `sleep`),便于整流程 mock 单测。每步用 `waitUntil` 轮询(`POLL=50ms`)直到谓词成立或超时;`AbortSignal` 任意点可打断。阶段通过 `onPhase` 回调暴露给 UI。

**新增发送类原语,一律走「逐步验证 + 失败带阶段抛错」这个范式。** 别写「发了就当成了」。

### 4.4 resolver 工厂 `sendSlashCommand`(`src/send/sendSlashCommand.ts`)

斜杠命令 = `sendMessage(command, {submit:false})` 清空+写入 → 提交 → **轮询一个 `SlashSpec.resolve(ctx)` 取结果**(返回非 `undefined` 即完成;`dismiss:true` 时完成后发 `\x1b` Esc 关浮层)。两个内置 resolver 工厂:

- **`fromJsonlStdout<T>(parse?)`**——打印型命令(如 `/context`):从 jsonl 的 `system` 行 `<local-command-stdout>…</local-command-stdout>` 取结果,剥 ANSI、可选 `parse`。
- **`fromScreenOverlay<T>(isReady, parse, dismiss=true, settlePolls=6)`**——模态浮层(如 `/usage`):等 `isReady(screen)` 为真,再**等解析结果连续 `settlePolls` 次不变(settle)** 才返回、再 Esc 关闭(坑 #7:浮层有异步加载元素,不等稳定会读到骨架还过早 Esc)。

`isReady` 必须用「真模态」信号区分活动浮层与 transcript 历史残留(坑 #6):`runUsage` 用 `detectUsage(s) && !detectIdle(s)`。

### 4.5 SSE 会话跟随(`server/ssePlugin.ts`)

`?session=<tmux名>` 模式下,服务端**持续跟随会话当前 jsonl**:每 1.5s 重解析,文件变了就 `watcher.close()` + 新建 reader(从头发)+ 发 `event: meta {switched:true}`。原因见坑 #8。浏览器侧 `useJsonl` 的 `src` 用 `'session:ccfly-ttyd'` 触发此模式。

### 4.6 读屏 screen + suggest

见 3.3。要点:`readScreen` 是纯文本,`readSuggest` 必须读 cell `isDim()`;判「输入框是否为空」一定要减掉鬼影。

---

## 5. 扩展步骤

### 5.1 新增一个**状态检测器**

1. 抓真实屏存进 `test/fixtures/screen/<name>.txt`(原始抓屏,**不含** tmux 状态栏——单测里用 `withTmuxBar()` 追加它来模拟线上)。
2. 新建 `src/state/detectors/<name>.ts`:导出 `detectXxx(lines: string[]): boolean`(jsonl 族则吃 `JEvent[]`)。
   - 文件头注释写明:语义 / 锚点选择理由 / 如何排除相邻面板。
   - 选**稳定内容锚点**,扫**末尾窗口**(或整屏,若锚点在浮层顶部、会被推出窗口——参考 `config`/`mcp`/`plugin` 用整屏 `lines.some(...)`)。
3. 在 `src/state/types.ts` 的 `Status` 联合里加上新值(若是顶层状态),并在 `StatusPanel.vue` 的 `color` 表加配色。
4. 在 `src/state/index.ts`:`import` + `export` 该检测器,并在 `sessionStatus` 的 if/else 链里**插到正确的优先级位置**。
5. 写 `test/<name>.test.ts`:正样本(含 `+ tmux 状态栏` 变体)必须 true、所有相邻面板负样本必须 false、空输入 `[]` 必须 false。参考 `test/idle.test.ts` 的 `POSITIVE` / `NEGATIVE` 结构。
6. 跑 `npm test`,再用 `node server/state-check.ts` 对真实数据回归一遍。

### 5.2 新增一个**斜杠命令**

1. **先确认真名**:用 `/`(在 claude 里)看补全面板里的精确命令名。**必须用精确命令名**(坑 #4)。
2. 决定结果来源:
   - 打印型(结果落 jsonl `local-command-stdout`)→ 用 `fromJsonlStdout`。
   - 模态浮层(结果在屏上)→ 用 `fromScreenOverlay`,并写 `isReady`(带「真模态」判别,如 `detectXxx(s) && !detectIdle(s)`)和 `parse`。
3. 在 `src/send/commands.ts` 加一个函数:`export function runXxx(deps: SlashDeps): Promise<T> { return sendSlashCommand('/xxx', spec, deps) }`。
4. UI:在 `src/components/SlashBar.vue` 的按钮区加一个 `run('/xxx', () => runXxx(deps()))`。
5. 写 `test/sendSlashCommand.test.ts` 风格的单测(用 `harness(onSubmit)` mock 提交后产生的 events/screen)。
6. 浮层型记得 `dismiss:true`,并验证测试里 `sent` 包含 `'\x1b'`(发了 Esc)。

---

## 6. 命名与目录约定

- **检测器**:`src/state/detectors/<state>.ts`,导出 `detect<State>(...)`(`detectIdle` / `detectSelect` …)。一个状态一个文件一个函数。
- **状态值**:`Status` 联合,kebab-case(`awaiting-tool`),只在 `types.ts` 定义。
- **发送原语**:`src/send/`,函数动词开头(`sendMessage` / `sendSlashCommand`);具体命令 `run<Cmd>`(`runContext` / `runUsage`)。
- **composable**:`src/composables/use<Thing>.ts`,导出 `use<Thing>`。
- **组件**:`src/components/*.vue`,PascalCase,`<script setup lang="ts">`,props 用 `defineProps<{…}>()`。
- **服务端**:`server/*.ts`,Node 环境,显式带 `.ts` 后缀 import(`allowImportingTsExtensions`)。
- **fixture**:屏抓 `test/fixtures/screen/<name>.txt`(真实抓屏,不含 tmux 栏);jsonl `test/fixtures/jsonl/<name>.jsonl`(**脱敏**真实行)。
- **测试**:`test/<unit>.test.ts`,vitest,`environment: 'node'`。fixture 用 `new URL('./fixtures/...', import.meta.url)` 读。
- import 一律带 `.ts` 后缀(项目开了 `allowImportingTsExtensions` + `verbatimModuleSyntax`)。

---

## 7. 控制 TUI 的字节原语清单(必背)

| 目的                     | 字节                             | 发法                                               | 说明                                                                                                 |
| ------------------------ | -------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **清空输入框**           | `\x01\x0b\x7f`                   | **小帧逐发**,每帧间隔 ~10ms,重复多次(代码里 24 次) | C-a 行首 + C-k 删到尾 + 退格删空行;多行安全。**不要用 Ctrl+U(`\x15`)单发**——跟光标位置,不可靠(坑 #2) |
| **写入任意文本**         | `\x1b[200~` + 文本 + `\x1b[201~` | 整段一次发                                         | bracketed paste;含换行不会中途提交;大段会被折叠成 `[Pasted text]` chip(坑 #3)                        |
| **提交**                 | `\r`                             | 单发                                               | 回车。提交后**读 jsonl 确认**真发出去了                                                              |
| **关闭浮层 / 取消**      | `\x1b`                           | 单发                                               | Esc。`fromScreenOverlay` 读完结果后发(settle 之后,别过早发)                                          |
| **控制键(C-a / C-k 等)** | 对应控制字符                     | **必须小帧逐发**                                   | 大坨突发输入会被 claude 当「粘贴/批量」,控制字符按字面插入;只有小帧逐发才当按键(坑 #1)               |

> 所有「发字节」都经 `useLiveTerminal` 的 `send()`(写 INPUT 轨)。

---

## 8. 必须遵守的「硬核坑」条款

以下每条都是踩出来的。**改相关代码前先读懂对应条款**,不要「优化」掉它们。

1. **大坨突发输入会被当粘贴/批量。** 控制字符在批量里按字面插入;控制键(C-a/C-k)只有**小帧逐发**才当按键。→ 凡发控制键,逐帧 + 间隔。

2. **清空输入框只信「小帧逐发 `\x01\x0b\x7f` 重复多次」。** C-a 行首 + C-k 删到尾 + 退格删空行,多行安全。**禁用 Ctrl+U 单发**(跟光标位置,不可靠)。

3. **写入文本一律用 bracketed paste**(`\x1b[200~…\x1b[201~`)。含换行不会中途提交;大段会被折叠成 `[Pasted text]` chip——所以验证用 `inputMatches`(chip 时做结构性确认,别要求逐字相等)。

4. **斜杠命令必须用精确命令名。** 输入 `/` 会弹模糊补全,回车选的是**高亮项**;非精确名会被匹配到别的命令(实测 `/cost` 会跑成 `/context`)。真名是 `/usage`(面板标注 `/usage (cost)`)。新命令先在 claude 里确认补全面板里的真名。

5. **空输入会显示 dim 鬼影建议,纯文本分不出。** 必须读 cell `isDim()`(`readSuggest`);判「输入框是否为空」要**减掉鬼影**(`App.vue` 的 `readInput()`)。否则 `sendMessage` 清空验证会把建议当残留而误判失败。

6. **屏幕型 resolver 会误命中 transcript 里上次命令的残留。** `isReady` 必须带「真模态」信号(如 `!detectIdle`)区分活动浮层与历史。否则会提前 resolve、返回脏数据。

7. **浮层有异步加载元素,要 settle 再读再关。** `fromScreenOverlay` 要求解析结果连续 N 次(`settlePolls`,默认 6)不变才算就绪——否则读到骨架还过早 Esc 把面板关掉。

8. **SSE 必须跟随会话当前 jsonl。** claude 冷启动 / `/clear` 会换文件;connect 时锁死的旧文件会跟丢 → `/context` 这类靠 jsonl 取结果的命令永远收不到 → 超时。`session` 模式每 1.5s 重解析并切文件(`ssePlugin.ts`)。

9. **状态来源分工不能混。** screen = 实时 UI 控件态(idle/busy/menu/offline;jsonl 会滞后);jsonl = 语义/元数据(turn/mode/title/error)。**实时 busy/idle 以屏为准**;offline 要正面 shell 证据、放最后;认不出 → `unknown`(不要瞎兜到 idle/offline)。

10. **detectors 是纯 `string[]`(可 fixture 单测)。** 鬼影/dim 需要 cell 属性,**单独放在读屏层**(`readSuggest`),不要把 cell 依赖塞进检测器,否则没法用纯文本 fixture 单测。

11. **confirm-send 范式:每步用最权威源验证,失败抛带阶段的 `SendError`。** clear/type 用读屏、submit 用 jsonl。不要省略任何一步验证。

12. **`erasableSyntaxOnly` 已开启。** 禁用不可擦除语法:构造函数参数属性(`constructor(private x)`)、`enum`、`namespace` 带运行时语义的写法等。`SendError` 是手写赋值字段(看 `sendMessage.ts`),别改成参数属性。

13. **xterm 视图里最后一行是 tmux 状态栏。** 检测器扫**末尾窗口**(`slice(-TAIL)`)而非最后一行;`capture-pane` 抓出来不含状态栏,所以 fixture 不含它、单测用 `withTmuxBar()` 追加来模拟线上。

---

## 9. 提交前检查

依次跑(对应 `package.json` scripts):

```bash
npm run typecheck   # vue-tsc -b(含 erasableSyntaxOnly / noUnused* 检查)
npm run lint        # eslint .(必要时 npm run lint:fix)
npm run format:check # prettier --check .(或 npm run format 自动改)
npm test            # vitest run —— 当前 274 通过,不得回退
```

额外:

- 改了检测器 → 跑 `node server/state-check.ts` 对真实 `~/.claude/projects` 数据回归。
- 改了发送/命令 → 补/跑对应 `test/send*.test.ts`,确保 happy path + 各阶段失败 + 打断三类用例都在。
- 新增状态/命令 → fixture + 单测齐全(正样本含 `+ tmux 栏` 变体,相邻面板负样本必 false)。

四项全绿才提交。
