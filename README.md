# ccfly-ttyd-ui

Vue 3 + Vite + TypeScript。连 ttyd 的字节流,用浏览器内的 xterm 重建网格,客户端做 screen→struct。

独立项目,不依赖任何 ccfly 服务。

## 跑起来

```bash
# 1) 装依赖
npm install

# 2) 起 ttyd + 真实 claude(一个终端窗口常驻)
chmod +x scripts/serve-ttyd.sh
./scripts/serve-ttyd.sh            # ws://127.0.0.1:7682/ws

# 3) 起前端(另一个终端窗口)
npm run dev
```

打开 dev 给的地址。左边是实时终端(可直接操作 claude),右边是 `detect.ts` 每 50ms 解析出的结构化状态。

地址可在顶栏输入框改,或用 `.env.local` 的 `VITE_TTYD_URL` 设默认值。

## 工具

```bash
npm run typecheck   # vue-tsc
npm run lint        # eslint
npm run format      # prettier
npm run build       # 产物到 dist/
```

## 代码

- `src/ttyd.ts` — ttyd WebSocket 客户端(帧协议)。
- `src/composables/useLiveTerminal.ts` — 挂 xterm + 连 ttyd + 双向桥接。
- `src/terminal.ts` — 从 xterm 网格读可见行(+ best-effort 输入建议)。
- `src/detect.ts` — **screen→struct 解析器(唯一一份,在这改)**。
- `src/composables/useScreenState.ts` — 50ms 节拍读屏 → detect → 响应式状态。
- `src/components/StatePanel.vue` — 把 struct 渲染出来对照。
