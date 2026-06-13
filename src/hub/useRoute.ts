// hub/useRoute.ts — History API 路由(无第三方依赖),移植自 App.tsx 的 useRoute。
//   /                       跨设备会话卡片(首页;/sessions 为旧链兼容别名)
//   /devices                设备管理(改名/删除/统计,不再从这里进会话)
//   /d/<device>             某设备工作区(会话由 Workspace 内部选)
//   /d/<device>/<session>   深链到某会话
//   /link/<pairId>          无码配对确认页
// 后端 GET / 兜底把非文件路径回退成 index.html,故以上都可深链 / 刷新 / 后退。
import { ref, computed, onMounted, onUnmounted, type ComputedRef } from 'vue'

export type Route =
  | { name: 'devices' }
  | { name: 'allSessions' }
  | { name: 'sessions'; device: string }
  | { name: 'session'; device: string; session: string }
  | { name: 'link'; pairId: string }

export function parseRoute(path: string): Route {
  const p = path.split('/').filter(Boolean).map(decodeURIComponent)
  if (p[0] === 'link' && p[1]) return { name: 'link', pairId: p[1] }
  if (p[0] === 'devices') return { name: 'devices' }
  if (p[0] === 'sessions') return { name: 'allSessions' } // 旧 /sessions 深链兼容
  if (p[0] === 'd' && p[1]) {
    return p[2]
      ? { name: 'session', device: p[1], session: p[2] }
      : { name: 'sessions', device: p[1] }
  }
  return { name: 'allSessions' } // 首页 = 会话卡片
}

export function useRoute(): { route: ComputedRef<Route>; navigate: (to: string) => void } {
  const path = ref(location.pathname)
  const on = (): void => {
    path.value = location.pathname
  }
  onMounted(() => window.addEventListener('popstate', on))
  onUnmounted(() => window.removeEventListener('popstate', on))
  const navigate = (to: string): void => {
    if (to !== location.pathname) {
      window.history.pushState(null, '', to)
      path.value = to
    }
  }
  return { route: computed(() => parseRoute(path.value)), navigate }
}
