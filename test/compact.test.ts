import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectCompact } from '../src/state/detectors/compact.ts'
import { detectSelect } from '../src/state/detectors/select.ts'
import { detectBusy } from '../src/state/detectors/busy.ts'

const fx = (n: string): string[] =>
  readFileSync(new URL('./fixtures/screen/' + n + '.txt', import.meta.url), 'utf8').split('\n')

// 模拟线上:ttyd/xterm 读屏时最后一行是 tmux 状态栏(fixture 不含它)。
const withTmuxBar = (lines: string[]): string[] => [...lines, '[ccfly-clo0:2.1.170*   "host" 22:33 10-Jun']

describe('detectCompact', () => {
  it('压缩中 → 解析屏上真·百分比', () => {
    expect(detectCompact(fx('compacting'))).toBe(11)
    expect(detectCompact(withTmuxBar(fx('compacting')))).toBe(11)
  })

  it('百分比在「Compacting conversation…」同一行也认', () => {
    expect(detectCompact(['· Compacting conversation… 73%'])).toBe(73)
  })

  it('「Compacting conversation…」已出现但进度条这一帧还没渲染 → 0(已在压缩、起点)', () => {
    expect(detectCompact(['· Compacting conversation…', '', '● 其它内容无百分比'])).toBe(0)
  })

  it('0% 与 100% 都在合法区间', () => {
    expect(detectCompact(['Compacting conversation…  0%'])).toBe(0)
    expect(detectCompact(['Compacting conversation… 100%'])).toBe(100)
  })

  it('非压缩屏 → null(不抓别处的百分比)', () => {
    expect(detectCompact(fx('idle'))).toBeNull()
    expect(detectCompact(fx('busy'))).toBeNull() // /context 面板里有「(2%)」,但无 Compacting 行 → 不误抓
    expect(detectCompact([])).toBeNull()
  })

  it('完成后过去式「Compacted (ctrl+o …)」→ null(= 收尾信号)', () => {
    expect(detectCompact(['❯ /compact', '  ⎿  Compacted (ctrl+o to see full summary)'])).toBeNull()
  })
})

// 压缩屏不能被别的检测器误判:它带「esc to interrupt」(busy 真),但「How is Claude…1: Bad 2: Fine」
// 用冒号且同一行,不构成编号菜单 → 必须 select=false。
describe('压缩屏与其它检测器不打架', () => {
  it('compacting → detectBusy 真(esc to interrupt)', () => {
    expect(detectBusy(fx('compacting'))).toBe(true)
  })
  it('compacting → detectSelect 假(survey 的 1: Bad 2: Fine 不是编号菜单)', () => {
    expect(detectSelect(fx('compacting'))).toBe(false)
  })
})
