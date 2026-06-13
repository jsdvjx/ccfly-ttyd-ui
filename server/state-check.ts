// 校验脚本:用真实数据跑 src/state 的判断函数。
//   node server/state-check.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  sessionStatus,
  detectTurn,
  detectSelect,
  detectOffline,
  detectBusy,
} from '../src/state/index.ts'
import type { JEvent } from '../src/state/types.ts'

function lines(p: string): string[] {
  try {
    return readFileSync(p, 'utf8').split('\n')
  } catch {
    return []
  }
}
function events(p: string): JEvent[] {
  const out: JEvent[] = []
  for (const l of lines(p)) {
    if (!l.trim()) continue
    try {
      out.push(JSON.parse(l))
    } catch {
      /* skip */
    }
  }
  return out
}

// 1) 屏幕函数:三种抓屏
console.log('=== screen 函数 ===')
for (const [name, f] of [
  ['menu', '/tmp/scr_menu.txt'],
  ['idle', '/tmp/scr_idle.txt'],
  ['offline', '/tmp/scr_offline.txt'],
] as const) {
  const L = lines(f)
  console.log(
    `  ${name.padEnd(8)} select=${detectSelect(L)} offline=${detectOffline(L)} busy=${detectBusy(L)}`,
  )
}

// 2) jsonl detectTurn 在所有主线 session 文件上的分布
const root = join(homedir(), '.claude', 'projects')
const mainFiles: string[] = []
for (const d of readdirSync(root)) {
  const dir = join(root, d)
  try {
    for (const f of readdirSync(dir)) {
      if (/^[0-9a-f-]{36}\.jsonl$/.test(f)) mainFiles.push(join(dir, f))
    }
  } catch {
    /* skip */
  }
}
const dist: Record<string, number> = {}
let newest = ''
let newestMs = -1
for (const f of mainFiles) {
  const ev = events(f)
  const t = detectTurn(ev)
  dist[t] = (dist[t] ?? 0) + 1
  const ms = statSync(f).mtimeMs
  if (ms > newestMs) {
    newestMs = ms
    newest = f
  }
}
console.log('\n=== jsonl detectTurn 分布(主线文件) ===')
console.log(' ', dist)

// 3) 端到端:最新 session 的 jsonl + 一张 idle 抓屏
console.log('\n=== sessionStatus(最新 jsonl + idle 屏) ===')
console.log(JSON.stringify(sessionStatus(events(newest), lines('/tmp/scr_idle.txt')), null, 2))
