import { describe, it, expect } from 'vitest'
import { parseContextUsage, parseSlashInvoke, isLocalCommandText, localStdoutPlain } from '../src/transcript/parseContext.ts'

// 真实 /context 的 <local-command-stdout> 形态:ANSI 着色的方格图 + 右侧文本列。
// 这里夹带几段 ANSI(\x1b[38;5;…m)与方格,确认剥色 + 吃方格列后能抽出纯文本。
const RAW = `<local-command-stdout> \x1b[1mContext Usage\x1b[22m
\x1b[38;5;244m⛀ \x1b[38;5;246m⛁ ⛁ \x1b[38;5;220m⛁ \x1b[38;5;140m⛀ \x1b[38;5;246m⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ \x1b[39m  Opus 4.8 (1M context)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   claude-opus-4-8[1m]
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   18.5k/1m tokens (2%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   Estimated usage by category
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System prompt: 2.5k tokens (0.3%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System tools: 11.2k tokens (1.1%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Skills: 4.7k tokens (0.5%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Messages: 8 tokens (0.0%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛶ Free space: 981.5k (98.2%)

MCP tools · /mcp (loaded on-demand)
└ 8 tools · 0 tokens

Skills · /skills
└ 40 skills · 4.7k tokens

/context all to expand</local-command-stdout>`

describe('parseContextUsage', () => {
  const ctx = parseContextUsage(RAW)!

  it('解析非 null', () => {
    expect(ctx).not.toBeNull()
  })

  it('剥 ANSI + 吃方格列后取出模型名/id/总量', () => {
    expect(ctx.model).toBe('Opus 4.8 (1M context)')
    expect(ctx.modelId).toBe('claude-opus-4-8[1m]')
    expect(ctx.usedLabel).toBe('18.5K')
    expect(ctx.totalLabel).toBe('1M')
    expect(ctx.usedPct).toBe(2)
  })

  it('分类明细带 token 数值与占比(bullet 已吞掉)', () => {
    expect(ctx.categories).toHaveLength(5)
    expect(ctx.categories[0]).toEqual({
      label: 'System prompt',
      tokensLabel: '2.5k',
      tokens: 2500,
      pct: 0.3,
    })
    const free = ctx.categories.find((c) => c.label === 'Free space')!
    expect(free.tokens).toBe(981500)
    expect(free.pct).toBe(98.2)
  })

  it('页脚 MCP/Skills 标题+明细配对', () => {
    expect(ctx.extras).toHaveLength(2)
    expect(ctx.extras[0]).toEqual({
      title: 'MCP tools',
      sub: '/mcp (loaded on-demand)',
      detail: '8 tools · 0 tokens',
    })
    expect(ctx.extras[1].title).toBe('Skills')
    expect(ctx.extras[1].detail).toBe('40 skills · 4.7k tokens')
    expect(ctx.hint).toBe('/context all to expand')
  })

  it('非 /context 输出返回 null', () => {
    expect(
      parseContextUsage('<local-command-stdout>nothing here</local-command-stdout>'),
    ).toBeNull()
  })
})

describe('parseSlashInvoke', () => {
  it('解析命令调用块的名字与参数', () => {
    const raw =
      '<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>'
    expect(parseSlashInvoke(raw)).toEqual({ name: '/context', args: undefined })
  })

  it('带参数', () => {
    const raw =
      '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'
    expect(parseSlashInvoke(raw)).toEqual({ name: '/model', args: 'opus' })
  })

  it('非命令块返回 null', () => {
    expect(parseSlashInvoke('just text')).toBeNull()
  })
})

// user 型 local-command 行(实测 jsonl:/model 真改模型时回显/输出以 user 事件落盘)的识别与净化。
describe('isLocalCommandText / localStdoutPlain', () => {
  it('识别三种 local-command 标签', () => {
    expect(isLocalCommandText('<command-name>/model</command-name>\n…')).toBe(true)
    expect(isLocalCommandText('<local-command-stdout>Set model…</local-command-stdout>')).toBe(true)
    expect(isLocalCommandText('<local-command-caveat>Caveat: …</local-command-caveat>')).toBe(true)
    expect(isLocalCommandText('普通用户提问,哪怕提到 command-name 字样')).toBe(false)
  })

  it('stdout → 剥标签剥 ANSI 的纯文本', () => {
    const raw =
      '<local-command-stdout>Set model to \x1b[1mOpus 4.8 (1M context)\x1b[22m</local-command-stdout>'
    expect(localStdoutPlain(raw)).toBe('Set model to Opus 4.8 (1M context)')
  })

  it('caveat 行与空输出 → ""(整条隐藏)', () => {
    expect(localStdoutPlain('<local-command-caveat>Caveat: do not respond</local-command-caveat>')).toBe('')
    expect(localStdoutPlain('<local-command-stdout></local-command-stdout>')).toBe('')
  })

  it('无 stdout 标签 → null(交回 SystemNotice)', () => {
    expect(localStdoutPlain('plain reminder text')).toBeNull()
  })
})
