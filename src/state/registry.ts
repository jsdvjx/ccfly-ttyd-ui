import type { JEvent, Status } from './types.ts'
import { detectSelect } from './detectors/select.ts'
import { detectUsage } from './detectors/usage.ts'
import { detectHelp } from './detectors/help.ts'
import { detectStatus } from './detectors/status.ts'
import { detectConfig } from './detectors/config.ts'
import { detectStats } from './detectors/stats.ts'
import { detectMcp } from './detectors/mcp.ts'
import { detectPlugin } from './detectors/plugin.ts'
import { detectBusy } from './detectors/busy.ts'
import { detectIdle } from './detectors/idle.ts'
import { detectOffline } from './detectors/offline.ts'
import { detectTurn } from './detectors/jsonl.ts'

// 屏判注册表:每行 = 一个「屏为权威」的状态。
// weight 越大优先级越高(= 原 if-else 自上而下的 source 顺序);本表 weight 互不相等,不会并列。
// match(screen) 为各检测器原样(签名不变)。refine(status, events) 可选:命中后用 jsonl 改写
// 输出 status(当前仅 busy:awaiting-tool vs generating)。
// 注意:jsonl 兜底(events.length → detectTurn,且置 source='jsonl')与 unknown 兜底
// 不在本表内 —— 它们不是「屏规则」(无 match(screen),且兜底还要改 source),
// 仍由 index.ts 的 sessionStatus 在 picker 返回 null 后作为显式 3 行尾处理。
export interface ScreenRule {
  status: Status
  weight: number
  match: (screen: string[]) => boolean
  refine?: (status: Status, events: JEvent[]) => Status
}

// 用「降序 weight」原样保留 source 顺序:select,usage,help,status,config,stats,mcp,plugin,busy,idle,offline。
// weight 间隔 10,未来插行无需重排号;表已按降序书写,使「视觉顺序 == 生效顺序」。
export const SCREEN_RULES: ScreenRule[] = [
  { status: 'select',  weight: 120, match: detectSelect },
  { status: 'usage',   weight: 110, match: detectUsage  },
  { status: 'help',    weight: 100, match: detectHelp   },
  { status: 'status',  weight: 90,  match: detectStatus },
  { status: 'config',  weight: 80,  match: detectConfig },
  { status: 'stats',   weight: 70,  match: detectStats  },
  { status: 'mcp',     weight: 60,  match: detectMcp    },
  { status: 'plugin',  weight: 50,  match: detectPlugin },
  {
    // 屏权威判「忙」;jsonl 细分:工具在飞(awaiting-tool)vs 生成文本(generating)。
    // 这里 status:'generating' 仅为名义占位 —— refine 必然改写,不影响输出;
    // 取非 awaiting 分支的值('generating')使该行在无 refine 时也读得真。
    status: 'generating',
    weight: 40,
    match: detectBusy,
    refine: (_status, events) =>
      detectTurn(events) === 'awaiting-tool' ? 'awaiting-tool' : 'generating',
  },
  { status: 'idle',    weight: 30,  match: detectIdle    },
  { status: 'offline', weight: 20,  match: detectOffline },
]

// picker:按 weight 降序遍历,返回首个命中规则的(必要时 refine 后的)status;全不中 → null。
// 模块加载期排序一次;weight 互不相等,排序结果确定且 == source 顺序。
const ORDERED: readonly ScreenRule[] =
  [...SCREEN_RULES].sort((a, b) => b.weight - a.weight)

export function pickScreenStatus(screen: string[], events: JEvent[]): Status | null {
  for (const rule of ORDERED) {
    if (rule.match(screen)) {
      return rule.refine ? rule.refine(rule.status, events) : rule.status
    }
  }
  return null
}
