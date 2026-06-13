import { describe, it, expect } from 'vitest'
import { writeFileSync, appendFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createJsonlReader } from '../server/jsonlReader.ts'

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'jr-')), 'x.jsonl')

describe('createJsonlReader', () => {
  it('增量 + 半行 + 截断重置', async () => {
    const f = tmpFile()
    writeFileSync(f, '{"i":1}\n{"i":2}\n')
    const r = createJsonlReader(f)
    expect((await r.read()).length).toBe(2)
    appendFileSync(f, '{"i":3}\n')
    expect((await r.read()).length).toBe(1)
    appendFileSync(f, '{"i":4') // 半行
    expect((await r.read()).length).toBe(0)
    appendFileSync(f, '}\n')
    expect((await r.read()).length).toBe(1)
    writeFileSync(f, '{"i":9}\n') // 文件变小 → 重读
    expect((await r.read()).length).toBe(1)
  })

  it('B-B7:多字节 UTF-8 跨读不损坏,offset 按源字节', async () => {
    const f = tmpFile()
    writeFileSync(f, '')
    const r = createJsonlReader(f)
    const ch = Buffer.from('世', 'utf8') // 3 字节 E4 B8 96
    appendFileSync(f, Buffer.concat([Buffer.from('a'), ch.subarray(0, 1)])) // 'a' + 第1字节
    expect(await r.read()).toEqual([]) // 无 \n + 半个多字节字符:留着,不损坏
    appendFileSync(f, Buffer.concat([ch.subarray(1), Buffer.from('\n')])) // 余 2 字节 + \n
    const recs = await r.read()
    expect(recs).toHaveLength(1)
    expect(recs[0].line).toBe('a世') // 不是 'a�'
    expect(recs[0].offset).toBe(Buffer.byteLength('a世\n', 'utf8')) // = 5,按源字节
  })

  it('B-B8:并发 read 不重复发行', async () => {
    const f = tmpFile()
    const content = Array.from({ length: 200 }, (_, i) => `{"i":${i}}`).join('\n') + '\n'
    writeFileSync(f, content)
    const r = createJsonlReader(f)
    const [a, b] = await Promise.all([r.read(), r.read()]) // 并发触发
    expect(a.length + b.length).toBe(200) // 不多不少
  })
})
