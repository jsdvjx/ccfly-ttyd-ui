// transcript/toItems.ts — 把一条原始 jsonl 行(JEvent)转成 Item。
// 纯函数移植 ccfly/go/internal/control/transcript.go 的 contentBlocks / extractStructuredPatch /
// resultTextRaw,并扩展:除 user/assistant 外,也把顶层 system 行发成 system Item(供 banner/divider 等)。
//
// 与 Go 的 /transcript 有一处有意分歧:/sse/jsonl 的行**带** image source.data(base64),Go 为 /transcript
// 剥掉了。这里保留 data,让 ImageChip 能直接用 data: URI,只有路径式(无 data)才需回 /image。
import type { JEvent } from '../state/types'
import type { Block, Item, PatchHunk } from './types'

const reImageSource = /^\[Image: source: (.+)\]$/

function shortModel(m?: string): string | undefined {
  if (!m) return undefined
  const x = m.toLowerCase()
  if (x.includes('opus')) return 'opus'
  if (x.includes('sonnet')) return 'sonnet'
  if (x.includes('haiku')) return 'haiku'
  return m
}

// resultTextRaw:tool_result.content 可能是 string 或 [{type:text,text}] 数组 → 取拼接文本。
function resultTextRaw(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    let s = ''
    for (const m of raw as Record<string, unknown>[]) if (typeof m.text === 'string') s += m.text
    return s
  }
  return ''
}

// resultImage:tool_result.content 里若含 image 块(读图片的结果),取第一张的 base64 data + media_type。
function resultImage(raw: unknown): { mediaType: string; data: string } | undefined {
  if (!Array.isArray(raw)) return undefined
  for (const m of raw as Record<string, unknown>[]) {
    if (m && m.type === 'image') {
      const src = (m.source as Record<string, unknown>) ?? {}
      if (typeof src.data === 'string') {
        return { mediaType: (src.media_type as string) || 'image/png', data: src.data }
      }
    }
  }
  return undefined
}

// contentBlocks:message.content(string 或 block 数组)→ Block[]。1:1 对应 transcript.go。
export function contentBlocks(content: unknown): Block[] {
  if (content == null) return []
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []
  const out: Block[] = []
  let imgIdx = 0 // 同一消息内对所有图片(路径式 + base64 式合计)连续编号,供 /image 定位
  for (const b of content as Record<string, unknown>[]) {
    switch (b.type as string) {
      case 'text': {
        const t = (b.text as string) ?? ''
        const m = reImageSource.exec(t.trim())
        if (m) {
          out.push({ type: 'image', path: m[1], imgIdx: imgIdx++ })
          break
        }
        if (t.trim()) out.push({ type: 'text', text: t })
        break
      }
      case 'image': {
        const src = (b.source as Record<string, unknown>) ?? {}
        out.push({
          type: 'image',
          mediaType: (src.media_type as string) || 'image/png',
          data: typeof src.data === 'string' ? src.data : undefined,
          imgIdx: imgIdx++,
        })
        break
      }
      case 'thinking':
        out.push({ type: 'thinking', text: (b.thinking as string) ?? '' }) // 多数为空(不持久化)
        break
      case 'tool_use':
        out.push({
          type: 'tool_use',
          id: b.id as string,
          name: b.name as string,
          input: (b.input as Record<string, unknown>) ?? {},
        })
        break
      case 'tool_result': {
        const tr: Block = {
          type: 'tool_result',
          forId: b.tool_use_id as string,
          content: resultTextRaw(b.content),
          isError: !!b.is_error,
        }
        const img = resultImage(b.content) // 读图片的结果 → 把图带上,供 ReadCard 直接渲染
        if (img) {
          tr.mediaType = img.mediaType
          tr.data = img.data
        }
        out.push(tr)
        break
      }
    }
  }
  return out
}

// extractStructuredPatch:Edit/MultiEdit 的 tool_result 行在顶层带 toolUseResult.structuredPatch(含上下文行的
// hunk 数组)。非空才返回,供贴到该行的 tool_result 块。
export function extractStructuredPatch(toolUseResult: unknown): PatchHunk[] | undefined {
  const tr = toolUseResult as Record<string, unknown> | null | undefined
  if (!tr || typeof tr !== 'object') return undefined
  const sp = tr.structuredPatch
  if (!Array.isArray(sp) || sp.length === 0) return undefined
  return sp as PatchHunk[]
}

// toItem:一条 JEvent → Item(user/assistant 渲染成气泡;顶层 system 发成 system Item;
// 其余 mode/permission/ai-title/snapshot 等侧车返回 null,由 state 检测器消费,不进 transcript)。
export function toItem(ev: JEvent): Item | null {
  const t = ev.type
  if (t === 'user' || t === 'assistant') {
    const blocks = contentBlocks(ev.message?.content)
    const patch = extractStructuredPatch(ev.toolUseResult)
    if (patch) for (const b of blocks) if (b.type === 'tool_result') b.patch = patch
    const textBlock = blocks.find((b) => b.type === 'text')
    return {
      role: t,
      blocks,
      text: typeof ev.message?.content === 'string' ? ev.message.content : textBlock?.text,
      ts: ev.timestamp,
      uuid: ev.uuid,
      model: t === 'assistant' ? shortModel(ev.message?.model) : undefined,
      outTokens:
        t === 'assistant' ? (ev.message?.usage?.output_tokens as number | undefined) : undefined,
      raw: ev,
    }
  }
  if (t === 'system') {
    return {
      role: 'system',
      kind: ev.subtype || 'system',
      text: ev.content,
      ts: ev.timestamp,
      uuid: ev.uuid,
      raw: ev,
    }
  }
  return null
}
