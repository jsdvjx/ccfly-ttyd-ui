import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectSelect, parseSelect } from '../src/state/detectors/select.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 模拟线上:ttyd/xterm 读屏时最后一行是 tmux 状态栏(fixture 不含它)。
const withTmuxBar = (lines: string[]): string[] => [
  ...lines,
  '[0] 0:claude* "host" 18:42 08-Jun-26',
]

const POSITIVE = ['select'] as const
const NEGATIVE = [
  'idle',
  'busy',
  'usage',
  'cost',
  'help',
  'status',
  'offline',
  'context',
  'subagent',
] as const

describe('detectSelect', () => {
  describe('正样本(选择菜单)必须 true', () => {
    for (const name of POSITIVE) {
      it(`${name} -> true`, () => {
        expect(detectSelect(fx(name))).toBe(true)
      })
      it(`${name} + tmux 状态栏 -> 仍 true`, () => {
        expect(detectSelect(withTmuxBar(fx(name)))).toBe(true)
      })
    }
  })

  describe('负样本必须 false', () => {
    for (const name of NEGATIVE) {
      it(`${name} -> false`, () => {
        expect(detectSelect(fx(name))).toBe(false)
      })
      it(`${name} + tmux 状态栏 -> 仍 false`, () => {
        expect(detectSelect(withTmuxBar(fx(name)))).toBe(false)
      })
    }
  })

  it('空输入 -> false', () => {
    expect(detectSelect([])).toBe(false)
  })

  // 回归(CDP 实证,cc-3fb21b9c 124×28 多端 attach):窄屏把 /model 菜单文字折行、菜单变高,
  // footer「Enter to set as default · … · Esc to cancel」被挤到 pane 末行(tmux 状态栏)之下、
  // readScreen 读不到。旧逻辑因此 return false → 模型菜单永不渲染。修复后 footer 缺席但有
  // 「❯ 连号编号块」即判为 select。下方就是当时客户端真实读到的视口(footer 离屏、状态栏在末行)。
  const NARROW_NOFOOTER = [
    '',
    '',
    '  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
    '   Select model',
    '   Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify',
    '   with --model.',
    '',
    '     1. Default (recommended)  Opus 4.8 with 1M context · Best for everyday, complex tasks',
    '     2. Fable                  Fable 5 · Most capable for your hardest and longest-running tasks · Uses your limits ~2×',
    '                               faster than Opus',
    '     3. Sonnet                 Sonnet 4.6 · Efficient for routine tasks',
    '     4. Haiku                  Haiku 4.5 · Fastest for quick answers',
    '   ❯ 5. Opus 4.8 ✔             Best for everyday, complex tasks (claude-opus-4-8)',
    '',
    '   ◉ xHigh effort ←/→ to adjust',
    '[ccfly-clo0:2.1.170*                                                       [0,0] "✳ x" 22:33 10-J',
  ]
  it('窄屏 footer 离屏 + ❯ 连号编号块 -> true(回归)', () => {
    expect(detectSelect(NARROW_NOFOOTER)).toBe(true)
    const v = parseSelect(NARROW_NOFOOTER)
    expect(v!.options.map((o) => o.num)).toEqual([1, 2, 3, 4, 5])
    expect(v!.options.find((o) => o.current)?.num).toBe(5)
  })
  it('markdown 引用编号列表(> 1. …)无 footer -> false(不误判)', () => {
    // '>' 是引用标记、非 claude 光标 ❯/›;footer 缺席时不得当成菜单。
    const quoted = ['> 1. first item', '> 2. second item', '> 3. third item', 'some prose below']
    expect(detectSelect(quoted)).toBe(false)
  })
})

describe('parseSelect', () => {
  it('解析编号选项 + 当前高亮(❯)+ 标题,文本剥掉前缀', () => {
    const v = parseSelect(fx('select'))
    expect(v).not.toBeNull()
    expect(v!.options).toEqual([
      {
        num: 1,
        text: 'Default (recommended)  Opus 4.8 with 1M context · Most capable for complex work',
        current: false,
      },
      {
        num: 2,
        text: 'Sonnet                 Sonnet 4.6 · Best for everyday tasks',
        current: false,
      },
      {
        num: 3,
        text: 'Haiku                  Haiku 4.5 · Fastest for quick answers',
        current: false,
      },
      {
        num: 4,
        text: 'Opus 4.8 ✔             Most capable for complex work (claude-opus-4-8)',
        current: true,
      },
    ])
    expect(v!.title).toBe(
      'Select model\nSwitch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model.',
    )
  })
  it('非 select 屏 -> null', () => {
    expect(parseSelect(fx('idle'))).toBeNull()
    expect(parseSelect([])).toBeNull()
  })
  it('解析力度档(◉ xHigh effort)→ effort=xHigh;无力度行 → 不带 effort 字段', () => {
    // /model 菜单底部「◉ xHigh effort ←/→ to adjust」→ effort 字段(驱动「两步:先模型后力度」)。
    expect(parseSelect(fx('select'))!.effort).toBe('xHigh')
    // 普通 select(无力度行)不应带 effort:用一个有 footer + ❯ 编号块、但无 effort 行的最小屏。
    const plain = [
      '   Do you trust the files in this folder?',
      '   ❯ 1. Yes, proceed',
      '     2. No, cancel',
      '   Enter to confirm · Esc to cancel',
    ]
    expect(parseSelect(plain)!.effort).toBeUndefined()
  })
})

// ── 回归:正文里的编号列表不得破坏菜单识别(CDP 实案)──
// assistant 消息常含「1. 2. 3.」编号列表;旧实现全屏收集编号行再要求「从 1 连号」,
// 正文列表混进来必败 → /model 菜单永远认不出 → 状态退回 jsonl 推断误报「生成中」。
// collectMenu 锚定「最后一个 1. 行」起的连号块后,正文列表天然被排除。
describe('detectSelect/parseSelect:正文编号列表共存(实案截屏)', () => {
  const screen = [
    '  3. 剩余增量:REST API(热加载路由表/查审计/健康检查)、HA。',
    '  你想先推哪个?',
    '⏺ Ran 1 stop hook',
    '  ⎿  Stop hook error: Failed with non-blocking status code: /bin/sh: uv: command not found',
    '▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
    '   Select model',
    '   Switch between Claude models. Your pick becomes the default for new sessions.',
    '     1. Default (recommended)  Opus 4.8 with 1M context · Best for everyday, complex tasks',
    '     2. Fable                  Fable 5 · Most capable for your hardest tasks',
    '     3. Sonnet                 Sonnet 4.6 · Efficient for routine tasks',
    '     4. Haiku                  Haiku 4.5 · Fastest for quick answers',
    '   ❯ 5. Opus 4.8 ✔             Best for everyday, complex tasks (claude-opus-4-8)',
    '   ◉ xHigh effort ←/→ to adjust',
    '   Enter to set as default · s to use this session only · Esc to cancel',
  ]
  it('正文有「3. …」列表 → 菜单仍识别', () => {
    expect(detectSelect(withTmuxBar(screen))).toBe(true)
  })
  it('parseSelect 只收菜单块、不混正文行', () => {
    const v = parseSelect(withTmuxBar(screen))
    expect(v).not.toBeNull()
    expect(v!.options.map((o) => o.num)).toEqual([1, 2, 3, 4, 5])
    expect(v!.options[4].current).toBe(true)
    expect(v!.options.some((o) => o.text.includes('剩余增量'))).toBe(false)
    expect(v!.model).toBe(true)
    expect(v!.effort).toBe('xHigh')
  })
  it('只有正文列表、无菜单 → false', () => {
    const noMenu = [
      '  1. 先做 A。',
      '  2. 再做 B。',
      '  3. 最后 C。',
      '  你想先推哪个?',
      '────────────────────────────────',
      '❯ ',
      '────────────────────────────────',
      '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
    ]
    expect(detectSelect(withTmuxBar(noMenu))).toBe(false)
  })
})
