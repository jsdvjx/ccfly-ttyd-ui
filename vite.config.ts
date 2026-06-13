import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { jsonlSse } from './server/ssePlugin.ts'

// 两种开发模式:
//   - 默认(脱机):用本仓的 Node 参考实现 jsonlSse() 提供 /sse/jsonl,无需 ccfly 也能开发 UI。
//   - 集成:设 VITE_CCFLY=http://127.0.0.1:7699 → 把 /term · /sse/jsonl · /sessions 代理到真 ccfly
//     二进制(Node 参考实现关闭),验证 UI 在真实传输上跑通。
// 生产:UI 由 ccfly go:embed 同源托管,不经 Vite。
const CCFLY = process.env.VITE_CCFLY

export default defineConfig({
  plugins: [vue(), ...(CCFLY ? [] : [jsonlSse()])],
  server: CCFLY
    ? {
        proxy: {
          '/sse/jsonl': { target: CCFLY, changeOrigin: true },
          '/sessions': { target: CCFLY, changeOrigin: true },
          '/sendkeys': { target: CCFLY, changeOrigin: true },
          '/upload': { target: CCFLY, changeOrigin: true },
          '/takeover': { target: CCFLY, changeOrigin: true },
          '/term': { target: CCFLY.replace(/^http/i, 'ws'), ws: true },
        },
      }
    : undefined,
})
