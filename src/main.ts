import { createApp } from 'vue'
import './style.css'
import './hub/hub.css'
import './theme/vscode.css'
import App from './App.vue'

createApp(App).mount('#app')

// PWA service worker:本地开发(localhost/127.0.0.1)跳过,避免拦截 vite dev 的 HMR。
// SW 只缓存 app shell,实时接口(/api、/x、/sse、/term、/sessions、/auth…)一律直通 —— 见 public/sw.js。
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.addEventListener('load', () => {
    // updateViaCache:'none' —— SW 脚本本身永远绕过 HTTP 缓存重新拉取,确保新版 sw.js 总能被发现安装
    // (否则旧 sw.js 被缓存复用 → SW 永不更新 → 用户卡在旧 bundle)。
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {})
  })
}
