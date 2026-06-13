import { shallowRef, onUnmounted, type Ref } from 'vue'
import type { Terminal } from '@xterm/xterm'
import { readScreen, readSuggest } from '../screen'

// useScreen — 循环读屏:固定节拍把可见屏读成 string[],并(从 cell dim 属性)读出建议鬼影。
// 优化:shallowRef(行数组当不可变快照,不深代理)+ 仅内容变化才赋值(避免无变化时 20Hz 空翻)
// + 隐藏标签页短路(后台不空转)。
export function useScreen(term: Ref<Terminal | null>, intervalMs = 50) {
  const screen = shallowRef<string[]>([])
  const suggest = shallowRef('')

  const changed = (a: string[], b: string[]): boolean => {
    if (a.length !== b.length) return true
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true
    return false
  }

  const timer = window.setInterval(() => {
    const t = term.value
    if (!t || document.hidden) return
    const next = readScreen(t)
    if (changed(screen.value, next)) screen.value = next
    const sg = readSuggest(t)
    if (sg !== suggest.value) suggest.value = sg
  }, intervalMs)

  onUnmounted(() => clearInterval(timer))
  return { screen, suggest }
}
