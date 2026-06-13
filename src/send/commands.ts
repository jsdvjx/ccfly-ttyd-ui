// 具体斜杠命令(基于 sendSlashCommand)。每个命令 = 命令文本 + 一个取结果的 spec。
import { detectUsage, detectIdle } from '../state'
import {
  sendSlashCommand,
  fromJsonlStdout,
  fromScreenOverlay,
  type SlashDeps,
} from './sendSlashCommand'

// /context —— 打印型:结果在 jsonl 的 local-command-stdout 里。返回输出原文。
export function runContext(deps: SlashDeps): Promise<string> {
  return sendSlashCommand('/context', fromJsonlStdout<string>(), deps)
}

// /usage —— 模态浮层(用量/花费)。⚠️ 必须用**精确命令名**:输入会触发命令补全面板,回车选的是
// 面板高亮项;非精确名(如 "/cost")会被模糊匹配到别的命令(实测 "/cost" 会跑成 /context)。
// 真名是 /usage(面板里标注 "/usage (cost)")。读完 Esc 关闭。返回提取出的统计行。
export function runUsage(deps: SlashDeps): Promise<string[]> {
  // isReady 必须区分「真模态打开」与「历史残留的旧用量文本」:模态会盖掉输入框,所以要求
  // detectUsage 命中 **且** 当前不是 idle 输入框态(!detectIdle)。否则 transcript 里上次
  // /usage 留下的行会让它提前 resolve、返回脏数据(实测过的坑)。
  const isReady = (s: string[]) => detectUsage(s) && !detectIdle(s)
  return sendSlashCommand('/usage', fromScreenOverlay(isReady, parseUsageScreen), deps)
}

// 从用量浮层屏幕里挑出有信息量的统计行(best-effort)。
function parseUsageScreen(screen: string[]): string[] {
  return screen
    .map((l) => l.trim())
    .filter((l) =>
      /%|Last\s*24h|usage|tokens|sessions?|cost|streak|active days|contributing/i.test(l),
    )
}
