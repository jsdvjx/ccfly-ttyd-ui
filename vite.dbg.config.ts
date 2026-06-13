// 临时内网调试配置(非提交):vite --host + 代理全部 ccfly 契约端点到本地 7701。
// node 模式(base=''),改 src/ 即热更。用完删。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
const H = 'http://127.0.0.1:7701'
const paths = [
  '/sse', '/sessions', '/transcript', '/subtranscript', '/subagents', '/workflow',
  '/workflowagent', '/capture', '/cmdresult', '/image', '/state', '/info', '/start',
  '/takeover', '/upload', '/sendkeys', '/healthz', '/jsonl',
]
const proxy: Record<string, unknown> = { '/term': { target: H.replace(/^http/, 'ws'), ws: true } }
for (const p of paths) proxy[p] = { target: H, changeOrigin: true }
export default defineConfig({
  plugins: [vue()],
  server: { host: true, port: 5175, proxy: proxy as never },
})
