# ccfly-ttyd-ui 测试规范(TESTING.md)

> 本规范是团队后续深入开发 ccfly-ttyd-ui 的测试约束基线。新增/改动任何「读屏判态」「确认式发送」「斜杠命令」「SSE 跟随」逻辑,**必须**按本规范补齐对应测试,否则不予合并。
>
> 当前基线:`test/*.test.ts` 共 15 个测试文件,274 个用例全绿。

---

## 0. 一句话原则

> **能用纯函数单测覆盖的,绝不上 mock 流程测;能用 mock 流程测覆盖的,绝不上 CDP e2e。** 但「看着对、其实发错/超时」这类只有真浏览器+真 claude 能暴露的回归,必须有 e2e 兜底。

本项目大量痛点来自 PTY/终端的真实物理行为(突发输入被当粘贴、控制键要小帧逐发、浮层异步加载、SSE 跟错文件)。这些痛点要么被设计成**可注入依赖**从而能在单测/mock 测里复现,要么只能在 e2e 里抓。本规范把每条痛点都落到一个明确的测试条款上。

---

## 1. 测试分层

项目代码刻意做成三层,测试也对应三层。**下层是上层的基础,改下层先改下层的测。**

### Layer 1 — 纯函数单测(主战场)

纯 `string[] → 结果` 或 `JEvent[] → 结果` 的函数,无副作用、无时间、无 DOM。覆盖:

- `src/screen.ts` 里能脱离 xterm 的部分(`readSuggest` 依赖 cell 属性,见 §1 的特殊条款)。
- `src/state/detectors/*`:**全部 detector**(idle/busy/select/usage/help/status/config/stats/mcp/plugin/offline + jsonl 族)。
- `src/state/index.ts` 的 `sessionStatus` 组合器。
- `src/send/sendMessage.ts` 的导出纯函数:`extractInputBox` / `inputMatches` / `findUserEvent`。
- `src/send/sendSlashCommand.ts` 的工厂 `fromJsonlStdout` / `fromScreenOverlay`(它们返回的 `spec.resolve` 是纯函数,可直接喂 `SlashCtx` 测,无需起流程)。
- `server/jsonlReader.ts` 的 `createJsonlReader`(读真实/临时文件,Node 环境)。

约定:输入用 fixture(屏)或内联构造(jsonl 事件)。

> **条款 1.1(detector 必须是纯 `string[]`)**:`src/state/detectors/*.ts` 里**所有屏幕型 detector 的签名必须是 `(lines: string[]) => boolean`**,jsonl 型必须是 `(events: JEvent[]) => …`。这是它们能被 fixture 单测的前提。任何 detector 都**不得**直接 import `@xterm/xterm`、不得读 cell 属性、不得碰 DOM/时间。
>
> **条款 1.2(鬼影/dim 只能在读屏层)**:需要 cell 的 `isDim()`/`isInverse()` 的逻辑(空输入的「鬼影建议」)**只能**待在 `src/screen.ts` 的 `readSuggest` 里,**不得**下沉进 detector。原因:detector 是纯 `string[]`,拿不到 cell 属性。`readSuggest` 的测试因为依赖 `Terminal`,归到 Layer 2(用真 xterm 或 mock buffer 构造 dim cell)。

### Layer 2 — mock 驱动的流程测(确认式发送 / 斜杠命令)

被测对象是带时序、带「写字节→观察反馈→再写」反馈环的异步流程:`sendMessage` / `sendSlashCommand` / `commands.ts`。这层**不连真终端**,而是用一个 **harness** 解释字节流、维护内部 `input/events/screen` 状态,把 PTY 的关键行为(只复现「对测试有意义」的那部分)模拟出来。

关键:这些流程函数**全部把副作用做成注入依赖**(`SendDeps` 的 `send` / `readInput` / `events` / `screen` / `sleep`),就是为了能在这一层 mock 整条链。

> **条款 2.1(注入,不要全局)**:任何新增的发送/命令流程,副作用(写字节、读屏、读事件、睡眠、定时)**必须经 deps 注入**,严禁直接调用 `setTimeout`/全局 `window`/真实 conn。`sleep` 默认 `setTimeout`,测试里注入 `() => Promise.resolve()`(见各 harness 的 `noSleep`),否则测试会真睡。

### Layer 3 — CDP e2e(puppeteer-core,真浏览器 + 真 ttyd/claude)

用 `puppeteer-core` 经 CDP 驱动真 Chrome,连真 `vite dev`(挂着 `jsonlSse` 中间件)+ 真 ttyd + 真 claude/tmux。只在 §5 列出的「物理层回归」场景使用。**当前仓库尚无 e2e 用例**(`puppeteer-core` 已在 devDeps,基础设施待建),新增需求触达 §5 清单时必须补建。

---

## 2. 目录与命名约定

```
test/
  <detector>.test.ts        # 每个屏幕 detector 一个文件:idle/busy/select/usage/help/status/config/stats/mcp/plugin/offline
  jsonl.test.ts             # jsonl 族 detector 全集(detectTurn/Mode/PermissionMode/Title/Interrupted/ApiError/Pending/LastActivity)
  combiner.test.ts          # sessionStatus 组合器(端到端 fixture → status)
  sendMessage.test.ts       # 确认式发送流程 + 其导出纯函数
  sendSlashCommand.test.ts  # 斜杠命令流程 + fromJsonlStdout/fromScreenOverlay
  jsonlReader.test.ts       # (待补)增量读取器
  e2e/*.e2e.ts              # (待建)CDP 用例,不进 vitest 默认 include
  fixtures/
    screen/<name>.txt       # 真实抓屏(纯文本,不含 tmux 状态栏)
    jsonl/<name>.jsonl      # 脱敏真实行(每行一个完整 JSON)
```

约定(已在现有代码落地,继续遵守):

- **文件名 = 被测单元名**:`detectIdle` → `test/idle.test.ts`。一个 detector 一个文件。
- **测试语言中文**,`describe/it` 标题用中文短语描述意图(参照现有 `'正样本(空闲输入框)必须 true'`)。
- **fixture 加载器**用标准三件套(直接抄,勿改路径风格):

```ts
import { readFileSync } from 'node:fs'
// 屏 fixture:按 \n 切成 string[]
const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')
// jsonl fixture:逐行 JSON.parse
function load(name: string): JEvent[] {
  const raw = readFileSync(new URL('./fixtures/jsonl/' + name + '.jsonl', import.meta.url), 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as JEvent)
}
```

- **import 带 `.ts` 后缀**(本仓库 ESM + verbatim 风格,现有测试统一 `from '../src/state/detectors/idle.ts'`)。
- **tmux 状态栏注入器**统一命名 `withTmuxBar`(见 §4),每个屏幕 detector 测都要用它做鲁棒断言。

---

## 3. fixture 约定

fixture 是本项目测试的命根子:detector 全靠它喂正负样本。**fixture 必须来自真实抓屏/真实 jsonl,禁止凭空手写一段「我觉得 claude 长这样」的文本**——claude 的面板文案/边框/footer 是判态锚点,编出来的样本会让测试假绿。

### 3.1 `test/fixtures/screen/`(真实抓屏)

**采集方式**:在真实 tmux + claude 会话里,用 `tmux capture-pane` 抓取可见网格写入 `<name>.txt`。例:

```bash
tmux capture-pane -p -t <session> > test/fixtures/screen/<name>.txt
```

**采集规约(条款)**:

> **条款 3.1(capture-pane 不含状态栏)**:`tmux capture-pane -p` 抓的是 **pane 内容,不含 tmux 状态栏**。因此 `fixtures/screen/*.txt` 一律**不带状态栏行**。线上路径是 ttyd→xterm 重建网格,**最后一行才是 tmux 状态栏**。这两者的差异由测试侧的 `withTmuxBar()` 补齐(§4),fixture 本身保持「干净 pane」。**绝不要把状态栏写进 fixture 文件。**

> **条款 3.2(锚点要在场)**:抓屏时确保面板的**判态锚点真的在可见区**。各 detector 的锚点是「面板正文里稳定出现、且会随消息滚动浮动但不出视口」的文字,而非会滚出视口的孤立 `Esc to cancel`。例:`select.txt` 必须含编号选项 `1.~4.` + `❯ 当前项` + footer `Enter to set as default · … · Esc to cancel`;`usage/cost.txt` 必须含 `% of your usage` / `Last 24h` 之类正文;`offline.txt` 必须含 `zsh: command not found:` 或 starship 时间尾 `at HH:MM:SS`。

**现有屏 fixture 清单(16 个,新增 detector 时按此补样本)**:
`idle / idle_typing / context / busy / subagent / select / usage / cost / help / status / config / stats_overview / stats_models / mcp / plugin / offline`

- `idle_typing` 是「输入框里有文字」的回归样本(footer 的 `← for agents` 已消失,只剩 `shift+tab to cycle`)——专门防「一打字就误判 unknown」。
- `cost` 与 `usage` 是同一面板的两份抓屏,组合器都判 `usage`(`/cost` 与 `/usage` 同面板)。
- `stats` 有两个子页:`stats_overview` / `stats_models`,两者都判 `stats`。

### 3.2 `test/fixtures/jsonl/`(脱敏真实行)

**造法**:从真实 `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` 里**截取一小段真实行**,然后**脱敏**:

- prompt/回复正文替换成 `<redacted prompt text>` / `<redacted>`;
- `uuid` 全置 `00000000-0000-0000-0000-000000000000`;
- `message.id` 改 `msg_REDACTED`;title 改 `Redacted session title`;
- **保留结构性字段不动**:`type` / `isMeta` / `stop_reason` / `content[].type` / `message.usage` 的形状 / `timestamp` / `permissionMode` / `mode` / `interruptedMessageId` / `isApiErrorMessage` / `apiErrorStatus` / `error` / `pendingBackgroundAgentCount` / `pendingWorkflowCount` / `content`(system 行的 `<local-command-stdout>…`)。

> **条款 3.3(脱敏不许动判态字段)**:脱敏只改「人类可读正文/标识符」,**绝不动 detector 判定要读的字段**。`src/state/types.ts` 的 `JEvent` 接口列出了所有被读字段——脱敏前对照这张表,凡在表里的字段保持原值/原形状。否则 fixture 与真实数据语义脱节,jsonl detector 会测错。

> **条款 3.4(一行一个完整 JSON)**:`*.jsonl` 每行必须是一个**单行完整 JSON**(claude 的真实落盘格式如此)。`createJsonlReader` 按 `\n` 切行、`local-command-stdout` 也假设单行,跨行 JSON 会破坏所有下游。

**现有 jsonl fixture 清单(9 个)**:
`turn-idle / turn-generating / turn-awaiting-tool`(三种回合态)、`mode / permission-mode / title / interrupted / apiError / pending`(元数据各一)。

---

## 4. 每个 detector 的「正样本 + 负样本 + tmux 状态栏鲁棒」三件套模板

这是本仓库测试最重要的模式。**每个屏幕 detector 的测试都必须含这三块**,缺一不可。模板(以 idle 为范本,新 detector 照抄):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectXxx } from '../src/state/detectors/xxx.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 模拟线上:ttyd/xterm 读屏时最后一行是 tmux 状态栏(fixture 不含它)。
const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

const POSITIVE = ['xxx' /* …本态的所有真实抓屏 */] as const
const NEGATIVE = [
  /* …所有其它态:让它们全判 false */
] as const

describe('detectXxx', () => {
  describe('正样本必须 true', () => {
    for (const name of POSITIVE) {
      it(`${name} -> true`, () => expect(detectXxx(fx(name))).toBe(true))
      // 【硬性】鲁棒:末尾补 tmux 状态栏后仍 true
      it(`${name} + tmux 状态栏 -> 仍 true`, () =>
        expect(detectXxx(withTmuxBar(fx(name)))).toBe(true))
    }
  })
  describe('负样本必须 false', () => {
    for (const name of NEGATIVE) {
      it(`${name} -> false`, () => expect(detectXxx(fx(name))).toBe(false))
      it(`${name} + tmux 状态栏 -> 仍 false`, () =>
        expect(detectXxx(withTmuxBar(fx(name)))).toBe(false))
    }
  })
  it('空输入 -> false', () => expect(detectXxx([])).toBe(false))
})
```

> **条款 4.1(tmux 状态栏鲁棒为硬性)**:每个屏幕 detector 的**每个正样本和每个负样本都必须有 `+ tmux 状态栏 -> 仍 …` 的配对断言**。理由:线上 xterm 网格**最后一行是 tmux 状态栏**,detector 因此**扫「末尾窗口」而非最后一行**(`idle` TAIL=12、`busy` TAIL=10、`select`/`status`/`offline` 各有 TAIL,顶部锚点型如 `config`/`mcp`/`plugin`/`stats`/`usage` 整屏或大窗口扫)。这条断言就是给「窗口余量够不够、会不会被状态栏挤掉锚点」上的回归锁。新 detector 调 TAIL 时,这两条断言会立刻告诉你余量够不够。

> **条款 4.2(负样本要全覆盖兄弟态)**:一个 detector 的 NEGATIVE 列表**必须囊括所有会被它误命中的兄弟面板**。判定容易撞车的几对,务必互列负样本:
>
> - `detectUsage` vs tab 行里的单词 `Usage`(`/help`/`/status`/`/context` 也有 tab):usage 只能用正文句式锚点(`% of your usage` 等),不能用单词 `Usage`。`help`/`status`/`config`/`context` 必须在 usage 的负样本里。
> - `detectStatus`(字段 `MCP servers:` 带冒号)vs `detectMcp`(标题 `Manage MCP servers`):互为负样本。
> - `detectConfig`(`Search settings`)vs `detectPlugin`(搜索框是 `⌕ Search…`):互不撞,但要各自把对方列入负样本证明不撞。
> - `detectSelect`(三要素:`Enter…to` + `Esc to cancel` + 连号编号菜单 + `❯`)vs `help`/`status`(只有 `Esc to cancel`)vs `subagent`(只有 `Enter to view`):三者都进 select 负样本。
> - `detectIdle` vs `busy`/`subagent`:idle 必须先排除 `esc to interrupt`(busy footer)再认空闲 footer——`busy`/`subagent` 进 idle 负样本。

> **条款 4.3(offline 是兜底,负样本=所有 claude 屏)**:`offline.test.ts` 的负样本**必须列全所有 claude 屏**(idle/busy/select/usage/cost/help/status/context/subagent + 后续新增的 config/stats/mcp/plugin),且每个都要带 tmux 状态栏变体。理由:offline 在组合器里**放最后**,只有「无任何 claude chrome + 末尾窗口有 shell 正面证据」才 true,任何 claude 屏误判 offline 都是严重回归。另需 `空屏/全空白 -> false`(宁可漏判也别误判)。

> **条款 4.4(组合器端到端用例)**:`combiner.test.ts` 维护一张 `CASES: Array<[fixtureName, expectedStatus]>`,**每个 fixture 都要列一行**,并对每行做 `+ tmux 状态栏 -> 仍 <status>` 配对。新增 detector/状态时,必须同时:① 在 `Status` 类型(`types.ts`)加成员;② 在 `sessionStatus` 的 if 链按**正确优先级**插入(浮层在前、busy/idle 居中、offline 倒数第二、unknown 兜底);③ 在 `CASES` 加端到端用例。组合器优先级一旦排错(例如把 offline 提前),靠的就是这张表兜住。

> **条款 4.5(jsonl detector 用内联或 fixture,覆盖 last-wins 与空输入)**:jsonl 族每个函数至少测:① 正常命中;② 无相关事件时的兜底(`detectMode([…无 mode…]) → null`、`detectTurn([]) → idle`);③ last-wins 语义(`detectMode`/`detectPermissionMode`/`detectTitle` 取**最后一条**)。`detectTurn` 三态(idle/generating/awaiting-tool)各一 fixture。

---

## 5. send / slash 的 mock harness 模板

### 5.1 sendMessage harness

harness 是一个**字节解释器**:把流程发出的字节翻译成对内部 `input`/`events` 的修改,只复现「对确认式发送有意义」的行为。范本(`test/sendMessage.test.ts` 现有,照抄并按需扩展 `breakStep` 故障注入):

```ts
const noSleep = (): Promise<void> => Promise.resolve()

function makeHarness(opts: { breakStep?: 'clear' | 'type' | 'submit' } = {}) {
  let input = 'leftover junk' // 起始非空:验证 clear 真的清空了
  const events: JEvent[] = []
  const send = (s: string) => {
    if (s.includes('\x01')) {
      // 清空键帧 \x01\x0b\x7f
      if (opts.breakStep !== 'clear') input = ''
    } else if (s.startsWith('\x1b[200~')) {
      // bracketed paste
      if (opts.breakStep !== 'type') input = s.replace(/^\x1b\[200~/, '').replace(/\x1b\[201~$/, '')
    } else if (s === '\r') {
      // 提交
      if (opts.breakStep !== 'submit')
        events.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: input } })
    }
  }
  return {
    send,
    readInput: () => input,
    events: () => events,
    sleep: noSleep, // 注入,避免真睡
    timeouts: { clear: 300, type: 300, submit: 300 }, // 小超时,故障用例快速失败
  }
}
```

必测用例(现有,作为基线;扩流程时全部保留并新增对应项):

- **happy path**:`onPhase` 回调序列严格 `['clear','type','submit','done']`,且 `events` 落了一条内容匹配的 user。
- **submit=false**:只清空+写入,`events` 为空,`readInput()` == 草稿。
- **三段故障**:`breakStep: 'clear'|'type'|'submit'` 各抛 `SendError` 且 `step` 对应。
- **打断**:`AbortController().abort()` 后抛 `SendError` 且 `step === 'clear'`(在第一段就检测到)。

> **条款 5.1(每段失败都要带阶段)**:`sendMessage` 是 confirm-send 范式——**每步用最权威源验证**(clear/type 用读屏 `readInput`,submit 用读 jsonl `findUserEvent`),失败必抛**带 `step` 的 `SendError`**。测试必须对每段都断言 `toMatchObject({ step })`。新增阶段同理加用例。

> **条款 5.2(harness 必须复现「清空键是小帧」)**:harness 只认 `\x01`(C-a)开头的帧为清空。这映射真实坑:**清空靠小帧逐发 `\x01\x0b\x7f`(C-a 行首 + C-k 删到尾 + 退格删空行)重复多次**(`CLEAR_FRAMES=24`,每帧间 `sleep(10)`),`Ctrl+U` 单发不可靠。harness 不必复现「大坨突发被当粘贴」的物理,但**这条物理只有 e2e 能真正回归**(见 §6 条款 6.1)。

> **条款 5.3(写入用 bracketed paste,多行折叠成 chip)**:harness 解析 `\x1b[200~…\x1b[201~` 为写入。`inputMatches` 单测必须含「多行被折叠成 `[Pasted text …]` chip 也算匹配」一例(`inputMatches('[Pasted text #1 +4 lines]', 'a\nb\nc\nd\ne') === true`)。理由:大段文本会被 claude 折叠成 chip,精确比对会假阴。

`extractInputBox` / `inputMatches` / `findUserEvent` 还需各自的纯函数单测(现有齐全:单行/多行/空/无边框/真实 idle 帧/真实 idle_typing 取草稿;忽略 `isMeta`;`sinceIndex` 之前不算)。

### 5.2 sendSlashCommand harness

斜杠命令 harness 额外维护 `screen`,并在 `\r`(提交)时回调 `onSubmit` 来「产生命令结果」(jsonl 行或屏幕内容)。范本(`test/sendSlashCommand.test.ts` 现有):

```ts
function harness(onSubmit: (h: { events: JEvent[]; setScreen: (s: string[]) => void }) => void) {
  let input = 'old junk'
  const events: JEvent[] = []
  let screen: string[] = []
  const sent: string[] = []
  const send = (s: string) => {
    sent.push(s)
    if (s.includes('\x01')) input = ''
    else if (s.startsWith('\x1b[200~'))
      input = s.replace(/^\x1b\[200~/, '').replace(/\x1b\[201~$/, '')
    else if (s === '\r') onSubmit({ events, setScreen: (x) => (screen = x) })
  }
  const deps = {
    send,
    readInput: () => input,
    events: () => events,
    screen: () => screen,
    sleep: noSleep,
    timeouts: { clear: 300, type: 300, submit: 300 },
  }
  return { deps, sent } // sent 用于断言「dismiss 时发了 Esc \x1b」
}
```

必测用例:

- **`fromJsonlStdout`(打印型,/context)**:`onSubmit` push 一条 `type:'system'` 且 `content` 含 `<local-command-stdout>…</local-command-stdout>` → 取出去标签去 ANSI 的原文;带 `parse` 时返回解析值。
- **`fromScreenOverlay`(模态型,/usage)**:`onSubmit` `setScreen([...含用量正文...])` → resolve 出解析结果,且 `sent` 含 `\x1b`(读完 Esc 关闭)。
- **超时**:`onSubmit` 什么都不产生 → 抛 `SendError`(`step:'submit'`)。
- **打断**:abort 后抛 `SendError`。

> **条款 5.4(斜杠命令必须用精确命令名)**:`commands.ts` 里 `runUsage` 必须发 `'/usage'`、`runContext` 必须发 `'/context'`。**禁止用别名/近似名**:输入 `/` 会弹模糊补全面板,回车选的是**高亮项**,`'/cost'` 实测会被模糊匹配跑成 `/context`。测试层面:`commands.ts` 的用例要断言**真正发出的命令文本**(可在 harness 的 `sent` 里查 `\x1b[200~/usage\x1b[201~`)。

> **条款 5.5(模态 resolver 必须要求「真模态」)**:`fromScreenOverlay` 的 `isReady` 不能只看面板锚点,**必须叠加 `!detectIdle`** 之类「真模态盖住了输入框」的信号(见 `runUsage`:`isReady = s => detectUsage(s) && !detectIdle(s)`)。回归用例:构造一个「idle 输入框 + transcript 里有上次 /usage 残留文本」的 screen,断言 resolver **不**提前 resolve(否则会返回历史脏数据)。

> **条款 5.6(settle 后再读再关)**:`fromScreenOverlay` 带 `settlePolls`(默认 6):**解析结果连续 N 次轮询不变才算就绪**。回归用例:让 `onSubmit` 先 `setScreen` 一个「骨架」屏、几轮后再 `setScreen` 最终屏,断言 resolver **在内容稳定前不返回、也不发 Esc**(否则读到骨架还过早 Esc 把面板关掉)。可用「逐轮变化的 screen 序列 + 计数 resolve 调用」来驱动。

---

## 6. CDP e2e:什么时候**必须**用

mock harness 复现的是「字节语义」,复现不了 PTY/终端/claude 的**物理时序与渲染**。以下场景**只有真浏览器 + 真 ttyd + 真 claude** 能抓——「看着对、其实发错/超时」正是这类:

> **条款 6.1(突发输入 vs 小帧)**:验证「大坨突发输入会被 claude 当**粘贴/批量**、控制字符按字面插入;控制键(C-a/C-k)只有**小帧逐发**才当按键」。这是物理时序,mock 测不出——**改动清空原语(`CLEAR_FRAMES`、帧间隔、帧内容)必须配 e2e**:在真终端连发清空帧,断言输入框真清空(且没把控制字符当文字插进去)。

> **条款 6.2(bracketed paste 含换行不中途提交 / 大段折叠成 chip)**:验证 `\x1b[200~…\x1b[201~` 包多行文本写入时**不会在换行处误触发提交**,且大段被折叠成 `[Pasted text]` chip。mock 只断言字符串相等,抓不到「换行被当回车提交了」这种真终端行为。

> **条款 6.3(命令补全选高亮项)**:验证斜杠命令在**真补全面板**里回车选中的就是期望命令(`/usage` 不会跑成别的)。这是 §5.4 那条坑的真实端到端确认。

> **条款 6.4(浮层异步加载 settle)**:验证 `/usage` 类面板的 cost 数字/图表**异步加载完**之后才被解析(settle 生效)、且 Esc 在正确时机发出。mock 用「逐轮变化序列」近似,但「面板真有异步骨架」只有 e2e 能证。

> **条款 6.5(SSE 跟随会话当前 jsonl)— 最高优先级 e2e**:验证 `?session=` 模式下,claude **冷启动 / `/clear` 换了新 jsonl 文件**时,SSE 会**切到新文件继续 tail**(`ssePlugin.ts` 的 `reresolve` 1.5s 轮询 + `event: meta {switched:true}`)。这是个**只有真会话切换才暴露**的坑:connect 那一刻锁死旧文件 → `/context` 这类靠 jsonl 取结果的命令**永远收不到 → 超时**。e2e 步骤:起 vite dev → 浏览器经 `useJsonl('session:<name>')` 连 → 在该 tmux 会话里 `/clear` 触发换文件 → 断言 `useJsonl` 收到 `switched:true` 的 meta、且换文件后新事件能到。

e2e 实现约定(待建基础设施):

- 用 `puppeteer-core`(已在 devDeps),连一个已运行的 Chrome(CDP endpoint),或 launch system Chrome。
- 测试文件放 `test/e2e/*.e2e.ts`,**不进 vitest 默认 `include`**(`vitest.config.ts` 当前 `include: ['test/**/*.test.ts']`)——避免 CI 单测被真环境拖慢/拖挂。单列脚本跑(见 §7)。
- e2e **不进**「274 必绿」基线门禁;它是「改物理层时手动/专门跑」的回归网。

---

## 7. 怎么跑

```bash
# 全量单测(= CI 门禁,vitest run;必须全绿)
npm test                              # 等价 vitest run,include: test/**/*.test.ts

# watch 模式(本地 TDD)
npm run test:watch                    # = vitest

# 单文件
npx vitest run test/idle.test.ts
npx vitest run test/sendMessage.test.ts

# 单用例(按标题过滤,中文标题用 -t)
npx vitest run -t '提交未确认'

# 真实数据冒烟(非 vitest,跑 src/state 判断函数在你机器上的真实 jsonl/抓屏)
node server/state-check.ts            # 需先把抓屏放 /tmp/scr_{menu,idle,offline}.txt

# 跟一个真实 jsonl 看增量(调 jsonlReader)
node server/watch.ts <jsonl-path>

# e2e(待建;不在 npm test 内)
# 约定脚本(建立时加入 package.json):  npm run test:e2e  →  跑 test/e2e/*.e2e.ts
```

合并前**必须全绿的门禁**:

```bash
npm test            # 单测 274+
npm run typecheck   # vue-tsc -b(含 erasableSyntaxOnly 校验,见条款 8.x)
npm run lint        # eslint .
npm run format:check
```

---

## 8. 新增功能必须配哪些测试(检查清单)

按改动类型逐条对照,缺项不合并:

**A. 新增/改一个屏幕 detector(`src/state/detectors/<x>.ts`)**

1. 采一份真实抓屏 → `test/fixtures/screen/<x>.txt`(条款 3.1/3.2,不含状态栏)。
2. `test/<x>.test.ts` 套用 §4 三件套模板:正样本 + 负样本(含所有会撞车的兄弟态,条款 4.2)+ **每条都配 tmux 状态栏变体**(条款 4.1)+ 空输入。
3. 把该状态加进 `Status`(`types.ts`)、`sessionStatus`(按正确优先级插入)、`combiner.test.ts` 的 `CASES`(条款 4.4)。
4. 若该状态会被 offline 误命中,补进 `offline.test.ts` 负样本(条款 4.3)。
5. 顺手在已有兄弟 detector 的负样本里加上新 fixture(确认它不被兄弟误命中)。

**B. 新增/改一个 jsonl detector(`src/state/detectors/jsonl.ts`)**

1. 脱敏真实行 → `test/fixtures/jsonl/<x>.jsonl`(条款 3.3/3.4)。
2. `jsonl.test.ts` 加:命中 + 兜底(null/默认值)+ last-wins(如适用)。
3. 若进 `SessionState`,更新 `types.ts` 接口与 `sessionStatus` 的返回组装,并在 `combiner.test.ts` 验证透传(参照 `suggest` 第三参透传用例)。

**C. 新增/改发送或斜杠命令流程(`src/send/*`)**

1. 副作用全部经 deps 注入(条款 2.1)。
2. 用 §5 harness 写:happy path(阶段序列断言)+ 每段故障(`SendError.step`)+ 打断 + 超时。
3. 斜杠命令:断言**精确命令文本**(条款 5.4);模态命令补 `isReady` 真模态用例(5.5)+ settle 用例(5.6);打印型补 stdout 取值用例。
4. 命中 §6 任一物理坑(突发/粘贴/补全/settle/SSE 跟随)→ **补 e2e**。

**D. 改 server SSE / jsonlReader(`server/*`)**

1. `createJsonlReader`:`test/jsonlReader.test.ts`(待补)覆盖——增量读、半行留到下次、`offset` 游标正确、**文件变小自动从头重读**(轮转/截断)。这些可用临时文件在 Node 环境单测。
2. 改 `ssePlugin` 的会话跟随逻辑(`jsonlForSession`/`reresolve`/`newestJsonl`)→ **必须配 e2e**(条款 6.5),纯函数部分(如「project 目录名编码 `cwd.replace(/[^a-zA-Z0-9]/g,'-')`」「主线文件正则 `^[0-9a-f-]{36}\.jsonl$`」)可抽出来单测。

**E. 改读屏层(`src/screen.ts`)**

1. `readScreen` 改动:验证仍是纯文本行、尾部空白 trim。
2. `readSuggest`(依赖 cell `isDim()`/`isInverse()`)改动:用真 `Terminal`(allowProposedApi)或构造带 dim cell 的 buffer 测——这是 Layer 2,不能用 `string[]` fixture。回归点:**空输入的鬼影建议不能被当成真内容**(否则 sendMessage 清空验证假阴),`sessionStatus` 的 `suggest` 第三参由此而来。

---

## 9. 工程约束条款(写测试时也要守)

> **条款 9.1(erasableSyntaxOnly)**:`tsconfig.app.json` 开了 `erasableSyntaxOnly`——**禁用构造函数参数属性、`enum` 等不可擦除语法**。注意 `SendError`(`src/send/sendMessage.ts`)是手写 `class … { step: SendStep; constructor(step, …){ this.step = step } }` 而**非**参数属性简写,就是为了过这条。测试里若构造类似辅助类,同样禁用参数属性、禁用 `enum`(用 union 字面量类型,如 `Status` / `SendStep`)。`npm run typecheck` 会卡。

> **条款 9.2(import 带 `.ts`、ESM)**:本仓库 `"type":"module"`,测试 import 统一带 `.ts` 后缀(`from '../src/state/detectors/idle.ts'`)。

> **条款 9.3(测试环境为 node)**:`vitest.config.ts` 设 `environment: 'node'`。需要 DOM/xterm 的测试(`readSuggest` 等)要么显式造 buffer,要么在该文件头切 `// @vitest-environment jsdom` 并自行引 `@xterm/xterm`——但优先保持纯 node,把依赖 DOM 的逻辑挡在读屏层。

> **条款 9.4(lint/format 也是测试门禁)**:`eslint`(含 `@typescript-eslint`、`eslint-plugin-vue`)+ `prettier` 必须通过。未用参数用 `_` 前缀(`argsIgnorePattern: '^_'`)。

---

## 附:硬核坑 → 测试条款对照表(交付即查)

| #   | 硬核坑                                                                        | 落到的条款               |
| --- | ----------------------------------------------------------------------------- | ------------------------ |
| 1   | 大坨突发被当粘贴/批量,控制键须小帧逐发                                        | 6.1(e2e)/ 5.2            |
| 2   | 清空靠小帧逐发 `\x01\x0b\x7f`×多次,Ctrl+U 不可靠                              | 5.2 / 6.1                |
| 3   | 写入用 bracketed paste,大段折叠成 chip                                        | 5.3 / 6.2                |
| 4   | 斜杠命令必须精确命令名(`/cost`→错,真名 `/usage`)                              | 5.4 / 6.3                |
| 5   | 空输入有 dim 鬼影,判空要减鬼影(`readSuggest`)                                 | 1.2 / 8.E                |
| 6   | 屏幕 resolver 会误命中 transcript 残留 → 要 `!detectIdle` 真模态              | 5.5                      |
| 7   | 浮层异步加载 → resolver 要 settle 再读再关                                    | 5.6 / 6.4                |
| 8   | SSE 必须跟随会话当前 jsonl(冷启动/clear 换文件)                               | 6.5(最高优先级 e2e)/ 8.D |
| 9   | 状态分工:screen 权威实时态、jsonl 给子类型+元数据、offline 最后、unknown 兜底 | 4.4 / 4.3 / 4.5          |
| 10  | detector 是纯 `string[]`;鬼影/dim 在读屏层                                    | 1.1 / 1.2                |
| 11  | confirm-send:每步用最权威源验证,失败抛带阶段 `SendError`                      | 5.1                      |
| 12  | erasableSyntaxOnly:禁参数属性/enum                                            | 9.1                      |
| 13  | 末行是 tmux 状态栏;detector 扫末尾窗口;capture-pane 不含状态栏                | 3.1 / 4.1                |

---

相关真实文件(绝对路径,供深读):

- 读屏:`/Users/jinxing/ccfly-ttyd-ui/src/screen.ts`
- detectors:`/Users/jinxing/ccfly-ttyd-ui/src/state/detectors/`(idle/busy/select/usage/help/status/config/stats/mcp/plugin/offline/jsonl)
- 组合器/类型:`/Users/jinxing/ccfly-ttyd-ui/src/state/index.ts`、`/Users/jinxing/ccfly-ttyd-ui/src/state/types.ts`
- 发送/命令:`/Users/jinxing/ccfly-ttyd-ui/src/send/{sendMessage,sendSlashCommand,commands}.ts`
- 服务端:`/Users/jinxing/ccfly-ttyd-ui/server/{ssePlugin,jsonlReader,watch,state-check}.ts`
- 现有测试与 fixture:`/Users/jinxing/ccfly-ttyd-ui/test/`(`*.test.ts`、`fixtures/screen/*.txt`、`fixtures/jsonl/*.jsonl`)
