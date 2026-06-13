import { watch } from 'node:fs'
import { createJsonlReader } from './jsonlReader.ts'

// CLI:跟一个 jsonl,先吃存量,之后增量打印每行的 offset + type。
//   node server/watch.ts <jsonl-path>
const path = process.argv[2]
if (!path) {
  console.error('usage: node server/watch.ts <jsonl-path>')
  process.exit(1)
}

const reader = createJsonlReader(path)

async function drain() {
  for (const rec of await reader.read()) {
    let type = '?'
    try {
      type = (JSON.parse(rec.line) as { type?: string }).type ?? '?'
    } catch {
      /* ignore */
    }
    console.log(rec.offset, type)
  }
}

await drain() // 存量
console.error(`[watching] ${path}`)
watch(path, () => {
  drain().catch(() => {})
})
