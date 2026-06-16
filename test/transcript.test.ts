import { describe, it, expect } from 'vitest'
import { contentBlocks, toItem } from '../src/transcript/toItems'
import { indexResults, itemKey } from '../src/transcript/indexResults'
import { groupTurns, isRealUserPrompt } from '../src/transcript/turns'
import { flattenTurn } from '../src/transcript/flattenTurn'
import type { JEvent } from '../src/state/types'
import type { Item, Turn } from '../src/transcript/types'

describe('contentBlocks', () => {
  it('string content → one text block; blank → none', () => {
    expect(contentBlocks('hello')).toEqual([{ type: 'text', text: 'hello' }])
    expect(contentBlocks('   ')).toEqual([])
    expect(contentBlocks(null)).toEqual([])
  })
  it('`!command` bash echo string → bash blocks (empty stderr skipped)', () => {
    expect(contentBlocks('<bash-input>pwd</bash-input>')).toEqual([
      { type: 'bash-input', text: 'pwd' },
    ])
    expect(contentBlocks('<bash-stdout>/x</bash-stdout><bash-stderr></bash-stderr>')).toEqual([
      { type: 'bash-stdout', text: '/x' },
    ])
    expect(contentBlocks('<bash-stdout></bash-stdout><bash-stderr>boom</bash-stderr>')).toEqual([
      { type: 'bash-stdout', text: '' },
      { type: 'bash-stderr', text: 'boom' },
    ])
  })
  it('flattens a mixed block array (text/thinking/tool_use/tool_result)', () => {
    const b = contentBlocks([
      { type: 'text', text: 'hi' },
      { type: 'thinking', thinking: '' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'out', is_error: false },
    ])
    expect(b.map((x) => x.type)).toEqual(['text', 'thinking', 'tool_use', 'tool_result'])
    expect(b[2]).toMatchObject({ name: 'Bash', id: 't1', input: { command: 'ls' } })
    expect(b[3]).toMatchObject({ forId: 't1', content: 'out', isError: false })
  })
  it('path-style image text → image block w/ path + imgIdx; base64 image → data+mediaType', () => {
    const b = contentBlocks([
      { type: 'text', text: '[Image: source: /tmp/a.png]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
    ])
    expect(b[0]).toMatchObject({ type: 'image', path: '/tmp/a.png', imgIdx: 0 })
    expect(b[1]).toMatchObject({ type: 'image', mediaType: 'image/jpeg', data: 'AAAA', imgIdx: 1 })
  })
  it('tool_result content as array of text parts → joined string', () => {
    const b = contentBlocks([
      {
        type: 'tool_result',
        tool_use_id: 't9',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
    ])
    expect(b[0].content).toBe('ab')
  })
})

describe('toItem', () => {
  it('assistant carries model(short) + outTokens', () => {
    const ev: JEvent = {
      type: 'assistant',
      uuid: 'u1',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hey' }],
        model: 'claude-opus-4-8',
        usage: { output_tokens: 42 },
      },
    }
    const it = toItem(ev)!
    expect(it).toMatchObject({ role: 'assistant', model: 'opus', outTokens: 42, text: 'hey' })
  })
  it('attaches structuredPatch to the tool_result block', () => {
    const ev: JEvent = {
      type: 'user',
      uuid: 'u2',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }],
      },
      toolUseResult: {
        structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }],
      },
    }
    const it = toItem(ev)!
    expect(it.blocks![0].patch).toHaveLength(1)
    expect(it.blocks![0].patch![0].lines).toEqual(['+x'])
  })
  it('extracts image from a tool_result (Read on an image) → mediaType+data on the block', () => {
    const ev: JEvent = {
      type: 'user',
      uuid: 'r1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't7',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            ],
          },
        ],
      },
    }
    const it = toItem(ev)!
    expect(it.blocks![0]).toMatchObject({
      type: 'tool_result',
      forId: 't7',
      mediaType: 'image/png',
      data: 'AAAA',
    })
    expect(indexResults([it]).t7).toMatchObject({ mediaType: 'image/png', data: 'AAAA' })
  })
  it('system row → system item(kind=subtype); sidecar rows → null', () => {
    expect(
      toItem({ type: 'system', subtype: 'compact_boundary', content: 'compacted' }),
    ).toMatchObject({
      role: 'system',
      kind: 'compact_boundary',
    })
    expect(toItem({ type: 'mode', mode: 'normal' })).toBeNull()
    expect(toItem({ type: 'ai-title', aiTitle: 'X' })).toBeNull()
  })
})

describe('indexResults + turns', () => {
  const items: Item[] = [
    { role: 'user', uuid: 'a', text: 'do it', blocks: [{ type: 'text', text: 'do it' }] },
    {
      role: 'assistant',
      uuid: 'b',
      blocks: [{ type: 'tool_use', id: 't1', name: 'Bash' }],
      outTokens: 10,
    },
    {
      role: 'user',
      uuid: 'c',
      blocks: [{ type: 'tool_result', forId: 't1', content: 'done', isError: false }],
    },
    { role: 'assistant', uuid: 'd', blocks: [{ type: 'text', text: 'ok' }], outTokens: 5 },
  ]
  it('indexResults maps tool_use_id → result', () => {
    expect(indexResults(items).t1).toMatchObject({ content: 'done', isError: false })
  })
  it('tool_result-only user line is NOT a real prompt', () => {
    expect(isRealUserPrompt(items[0])).toBe(true)
    expect(isRealUserPrompt(items[2])).toBe(false)
  })
  it('groups one turn from the prompt with accumulated outTokens + anchor', () => {
    const turns = groupTurns(items)
    expect(turns).toHaveLength(1)
    expect(turns[0].outTokens).toBe(15)
    expect(turns[0].anchorUuid).toBe('d')
  })
  it('itemKey prefers uuid, stable', () => {
    expect(itemKey(items[0])).toContain('a|')
    expect(itemKey({ role: 'system', kind: 'x', ts: '1' })).toBe('system|1|x||')
  })
})

describe('flattenTurn', () => {
  const mk = (items: Item[]): Turn => ({ items, durSec: 0, outTokens: 0 })
  it('merges consecutive tool calls across interleaved tool_result rows', () => {
    const turn = mk([
      { role: 'user', uuid: 'u', text: 'go', blocks: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', uuid: 'a1', blocks: [{ type: 'tool_use', id: 't1', name: 'Bash' }] },
      { role: 'user', uuid: 'r1', blocks: [{ type: 'tool_result', forId: 't1', content: 'o1' }] },
      { role: 'assistant', uuid: 'a2', blocks: [{ type: 'tool_use', id: 't2', name: 'Bash' }] },
      { role: 'user', uuid: 'r2', blocks: [{ type: 'tool_result', forId: 't2', content: 'o2' }] },
      { role: 'assistant', uuid: 'a3', blocks: [{ type: 'tool_use', id: 't3', name: 'Read' }] },
    ])
    const nodes = flattenTurn(turn)
    expect(nodes.map((n) => n.t)).toEqual(['user', 'tools'])
    const tools = nodes[1] as { t: 'tools'; tools: unknown[] }
    expect(tools.tools).toHaveLength(3) // 3 个连续工具并成一组
  })
  it('text/non-empty thinking break a tool run; empty thinking does not', () => {
    const turn = mk([
      {
        role: 'assistant',
        uuid: 'a1',
        blocks: [
          { type: 'thinking', text: '' }, // 空:跳过,不打断
          { type: 'tool_use', id: 't1', name: 'Bash' },
          { type: 'text', text: 'done' }, // 打断
          { type: 'tool_use', id: 't2', name: 'Bash' },
        ],
      },
    ])
    expect(flattenTurn(turn).map((n) => n.t)).toEqual(['tools', 'text', 'tools'])
  })
  it('pairs a `!command` input event with its following output into one bash node', () => {
    const turn = mk([
      { role: 'user', uuid: 'b1', blocks: [{ type: 'bash-input', text: 'pwd' }] },
      { role: 'user', uuid: 'b2', blocks: [{ type: 'bash-stdout', text: '/x' }] },
    ])
    const nodes = flattenTurn(turn)
    expect(nodes.map((n) => n.t)).toEqual(['bash'])
    const bash = nodes[0] as { t: 'bash'; blocks: { type: string }[] }
    expect(bash.blocks.map((b) => b.type)).toEqual(['bash-input', 'bash-stdout'])
  })
})

// user 型 local-command 行不是真提问(否则 <command-name>/ANSI 原文会铺成用户气泡)。
describe('isRealUserPrompt × user 型 local-command', () => {
  it('user 事件带 command-name / stdout 标签 → 非真提问', () => {
    const mk = (content: string) =>
      toItem({ type: 'user', message: { role: 'user', content }, timestamp: 't' } as never)!
    expect(
      isRealUserPrompt(mk('<command-name>/model</command-name>\n<command-message>model</command-message>')),
    ).toBe(false)
    expect(
      isRealUserPrompt(mk('<local-command-stdout>Set model to Opus</local-command-stdout>')),
    ).toBe(false)
    expect(isRealUserPrompt(mk('正常提问'))).toBe(true)
  })
})
