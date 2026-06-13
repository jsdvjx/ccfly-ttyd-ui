// select 屏幕态检测器(独立单元)。
// 语义:claude 弹着「选择菜单」(选模型 / 选项确认等)。判定三要素必须同时成立:
//   1) 底栏 footer:有「Enter…to …」(确认动作)且有「Esc to cancel」。
//   2) 编号选项 ≥2、从 1 起、连号(1,2,3,…)。
//   3) 含「❯ 当前项」标记(❯/›/> 紧贴某个编号项)。
//
// 为什么三要素缺一不可:
//   - usage / cost:既无 footer 又无编号菜单 → false。
//   - help / status:footer 只有「Esc to cancel」,没有「Enter…to」动作,也没有编号菜单 → false。
//   - subagent:底部代理坞有「Enter to view」,但没有「Esc to cancel」、也没有编号菜单 → false。
//   把「Enter…to」与「Esc to cancel」都要求上,正好把 help/status(只有后者)和
//   subagent(只有前者)排除;再叠加「编号菜单 + ❯」做硬约束,杜绝任何文案巧合。
//
// 锚点选择:用面板里稳定出现的内容特征(footer 文案 + 编号项 + ❯),
//   不依赖会随消息滚出视口的孤立 "Esc to cancel"。
//
// 视口窗口:线上经 ttyd/xterm 读屏时,最后一行是 tmux 状态栏(fixture 不含它),
//   所以 footer 扫「末尾若干行」而非假设它就是最后一行。footer 与编号项之间还可能
//   夹着别的控件行(如「◉ xHigh effort ←/→ to adjust」)与空行,故:
//     - footer 在末尾窗口里找(留足 tmux 状态栏 + 控件行的余量);
//     - 编号项在全屏里扫(它们可能被推到窗口之外)。

// footer 的两个动作锚点:
//   - 「Enter … to …」:确认类动作(Enter to set as default / Enter to confirm / …)。
//   - 「Esc to cancel」:取消。
const RE_ENTER_TO = /\benter\b.*\bto\b/i
const RE_ESC_CANCEL = /\besc\b\s+to\s+cancel\b/i

// 编号选项行:行首(容忍缩进)可选「❯ / › / >」当前项标记,后跟「N. 」或「N) 」+ 内容。
const RE_OPTION = /^\s*(❯|›|>)?\s*(\d+)[.)]\s+\S/u

// footer 末尾窗口行数:留出 footer 之下的控件行 + tmux 状态栏的余量。
const TAIL = 12

// SelectOption / SelectView — 解析出的选择菜单(供 UI 渲染可点选项)。
export interface SelectOption {
  num: number
  text: string
  current: boolean // 是否当前高亮项(❯)
}
export interface SelectView {
  title: string // 菜单上方的提示文字(最近的非空非选项行,best-effort)
  options: SelectOption[]
  effort?: string // 当前「力度」档(如 'xHigh');当前高亮模型支持力度时有,否则空(如 Haiku「not supported」)
  model?: boolean // 是否 /model 模型选择菜单 → UI 走「模型 + 力度」单面板;其它 select 走简洁单选
}

// 力度行:claude /model 菜单底部「◉ xHigh effort ←/→ to adjust」(◉=填充档位标记,←/→ 调节)。
// 存在即说明本菜单可调 effort —— UI 据此做「先选模型、再调力度」的两步。捕获当前档名。
const RE_EFFORT = /[◉●○]\s*(\S+)\s+effort\b/iu

// collectMenu — 收集**菜单面板**的编号选项块:锚定全屏「最后一个 1. 行」,自它向下取连号块
// (中间容忍折行/说明等非选项行,编号一断即停)。
//
// 为什么必须锚定而非全屏无差别收集:菜单永远渲染在屏幕底部面板,而其上的**正文常含编号列表**
// (assistant 消息里 1. 2. 3. 是家常便饭)。全屏收集会把正文列表混进来排在最前,「从 1 连号」
// 校验必败 → select 永远认不出(CDP 实证:正文末尾有「3. 剩余增量…」时 /model 菜单全程被
// 误判,状态退回 jsonl 推断 → 输入框错报「生成中」)。取**最后**的 1. 行 = 最贴近底部的
// 菜单起点;正文列表只会在它上方,天然被排除。
function collectMenu(lines: string[]): { idx: number; num: number; cur: boolean; marker: string }[] {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const m = RE_OPTION.exec(lines[i])
    if (m && Number(m[2]) === 1) start = i
  }
  if (start < 0) return []
  const opts: { idx: number; num: number; cur: boolean; marker: string }[] = []
  let expect = 1
  for (let i = start; i < lines.length; i++) {
    const m = RE_OPTION.exec(lines[i])
    if (!m) continue // 选项间的折行/说明行:跳过
    if (Number(m[2]) !== expect) break // 连号断裂 = 菜单块结束(其下杂项不收)
    opts.push({ idx: i, num: expect, cur: !!m[1], marker: m[1] || '' })
    expect++
  }
  return opts
}

// parseSelect — 若是 select 屏,解析出标题 + 编号选项(含当前高亮);否则 null。
// 复用 detectSelect 的判定;选项取 collectMenu 的菜单块(同一锚定口径,正文编号列表不混入),
// 文本去掉「❯/N.」前缀,标题取首个选项之上最近的非空文本行。
export function parseSelect(lines: string[]): SelectView | null {
  if (!detectSelect(lines)) return null
  const menu = collectMenu(lines)
  const options: SelectOption[] = menu.map((o) => ({
    num: o.num,
    text: lines[o.idx].replace(RE_OPTION_PREFIX, '').trim(),
    current: o.cur,
  }))
  const firstIdx = menu.length ? menu[0].idx : -1
  if (!options.length) return null
  // 标题块:首个选项之上的提示文本(常是「标题 + 一两行说明」)。向上收集非空、非选项、
  // 非分隔线的行,遇分隔线(▔/─ 等长串)或满 4 行即停;空行跳过不停。再反转成自上而下。
  const block: string[] = []
  for (let i = firstIdx - 1; i >= 0 && block.length < 4; i--) {
    const raw = lines[i]
    const t = raw.trim()
    if (!t) continue
    if (RE_SEPARATOR.test(t) || RE_OPTION.test(raw)) break
    block.push(t)
  }
  // 力度档(若有):全屏扫「◉ <档> effort」行,取当前档名;并据「effort 行存在 / 标题是 Select model」
  // 判定这是 /model 模型菜单(走单面板)。Haiku 等不支持力度的模型,其行是「Effort not supported」
  // (无 <档> 前缀)→ effort 为空但仍属模型菜单。
  let effort: string | undefined
  let effortLine = false
  for (const l of lines) {
    if (/\beffort\b/i.test(l) && /[←→]|adjust|not supported/i.test(l)) effortLine = true
    const em = RE_EFFORT.exec(l)
    if (em && !effort) effort = em[1]
  }
  const title = block.reverse().join('\n')
  const model = effortLine || /select model|switch between claude models/i.test(title)
  return {
    title,
    options,
    ...(effort ? { effort } : {}),
    ...(model ? { model: true } : {}),
  }
}

// 选项前缀(❯/›/> + N. / N))——解析文本时剥掉。
const RE_OPTION_PREFIX = /^\s*(❯|›|>)?\s*\d+[.)]\s+/u
// 分隔线:整行由框线/横线/下划线类字符组成(≥8),用于界定标题块上边界。
const RE_SEPARATOR = /^[\s▔▁▂▃▄▅▆▇█─━═＿_·]{8,}$/u

export function detectSelect(lines: string[]): boolean {
  // 1) footer:末尾窗口里要同时有「Enter…to」与「Esc to cancel」。
  // 注意:footer 可能被「挤出可视窗口」——窄屏(隐藏终端在 window-size=largest 多端 attach 下
  // 取到较窄列数,如 124)会把选项文字折行、菜单变高,footer 被顶到 pane 末行(tmux 状态栏)之下、
  // readScreen 读不到(CDP 实证:cc-3fb21b9c 124×28 多端 attach 时 footer 离屏 → 旧逻辑此处直接
  // return false,模型菜单永不渲染)。故 footer 不再是**硬闸**:它在时是强证据,不在时改由
  // 「❯/› 光标 + 连号编号块」这条同样唯一的特征兜底(见下)。
  const tail = lines.slice(-TAIL)
  const hasFooter = tail.some((l) => RE_ENTER_TO.test(l)) && tail.some((l) => RE_ESC_CANCEL.test(l))

  // 2)+3) 编号菜单:取 collectMenu 锚定的菜单块(自带「从 1 连号」语义;正文编号列表不混入)。
  const opts = collectMenu(lines)
  if (opts.length < 2) return false
  const cur = opts.find((o) => o.cur)
  if (!cur) return false // 必须有当前项标记

  // 通过条件:footer 在(原强判),或当前项标记是 claude 的 unicode 光标 ❯/›(而非 markdown 引用
  // 用的 '>')——后者把「footer 离屏」的窄屏菜单救回来,又不会把「> 1. …」这类引用编号列表误判成菜单。
  return hasFooter || cur.marker === '❯' || cur.marker === '›'
}
