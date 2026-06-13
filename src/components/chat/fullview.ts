// fullview.ts — 全屏查看器的注入契约。ChatView provide 一个 open(payload);需要的卡片(代码超长 / diff 超长 /
// 图片)inject 后点按钮/图片即全屏查看。判断「哪些该有按钮」由各卡自己决定(代码看行数、图片默认有)。
import { inject } from 'vue'
import type { PatchHunk } from '../../transcript/types'

export const FULLVIEW_KEY = 'ccfly:fullview'

export interface FullPayload {
  kind: 'code' | 'diff' | 'image'
  title?: string
  code?: string
  lang?: string | null
  hunks?: PatchHunk[]
  src?: string
}
export type OpenFull = (p: FullPayload) => void

export function useFullView(): OpenFull {
  return inject<OpenFull>(FULLVIEW_KEY, () => {})
}
