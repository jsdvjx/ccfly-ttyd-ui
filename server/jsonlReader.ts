import { open, stat } from 'node:fs/promises'

// JsonlRecord — 一条完整行 + 它末尾(含 \n)的字节偏移。
// offset 就是「下次从这里继续」的游标(SSE 的 Last-Event-ID 用它)。
export interface JsonlRecord {
  offset: number
  line: string // 原始行,不含 \n(UTF-8 解码)
}

// createJsonlReader — jsonl 增量读取器(Node)。
// 只读 offset→EOF,逐行切分并按**源字节**算每行末尾偏移;半行留到下次;文件变小自动重置。
// 不做 JSON.parse —— 解析是下游的事,这里只负责「把 append-only 文件切成 (offset, line)」。
//
// 两个关键正确性保证:
//   - 残留用 **Buffer**(不解码)跨次拼接:读窗口的边界可能切断多字节 UTF-8,先按字节找 \n、
//     整行才 toString('utf8'),避免 `�` 损坏与 offset 漂移(进而避免 SSE id/续传错位)。
//   - read() **串行化**:fs.watch 可能在一次 read 进行中再触发;不串行化两次都读 [offset..size]
//     → 同样的行被发两遍(实测 5000 行变 10000)。用 promise 链让 read 依次执行。
//
//   const r = createJsonlReader(path, startOffset)  // startOffset 用于断点续传
//   await r.read()   // → 自上次以来的新行
export function createJsonlReader(path: string, startOffset = 0) {
  let consumed = startOffset // 已发出完整行的末尾字节(= 续传游标)
  let fileOffset = startOffset // 已读到的字节(= 上次文件大小)
  let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0) // [consumed,fileOffset) 未成行的残留(字节,不解码)
  let chain: Promise<unknown> = Promise.resolve()

  async function doRead(): Promise<JsonlRecord[]> {
    const { size } = await stat(path)
    if (size < fileOffset) {
      consumed = 0 // 截断/重写(轮转、压缩)→ 从头重读
      fileOffset = 0
      leftover = Buffer.alloc(0)
    }
    if (size === fileOffset) return []

    const fh = await open(path, 'r')
    let chunk: Buffer
    try {
      const len = size - fileOffset
      const b = Buffer.allocUnsafe(len)
      const { bytesRead } = await fh.read(b, 0, len, fileOffset)
      chunk = b.subarray(0, bytesRead) // 只取真实读到的字节
      fileOffset += bytesRead
    } finally {
      await fh.close()
    }

    const data = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
    const out: JsonlRecord[] = []
    let prev = 0
    let nl: number
    while ((nl = data.indexOf(0x0a, prev)) !== -1) {
      const lineBuf = data.subarray(prev, nl) // 完整行字节(不含 \n)
      consumed += lineBuf.length + 1 // +1 = \n,按源字节推进 offset
      const line = lineBuf.toString('utf8') // 整行才解码 → 不切断多字节
      if (line.trim()) out.push({ offset: consumed, line })
      prev = nl + 1
    }
    leftover = data.subarray(prev) // 残留半行,保留为 Buffer
    return out
  }

  return {
    read(): Promise<JsonlRecord[]> {
      const result = chain.then(doRead)
      chain = result.catch(() => {}) // 链不因单次错误中断
      return result
    },

    get offset() {
      return consumed
    },
  }
}
