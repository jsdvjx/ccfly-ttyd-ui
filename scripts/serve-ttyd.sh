#!/usr/bin/env bash
# 起 ttyd,在一个 tmux 会话里跑真实 claude,供 UI 连(ws://127.0.0.1:7682/ws)。
# -W = 浏览器可写(能直接在网页里操作 claude)。
#   ./scripts/serve-ttyd.sh            # 端口 7682
#   ./scripts/serve-ttyd.sh 7799       # 自定义端口
set -euo pipefail
PORT="${1:-7682}"
exec ttyd -p "$PORT" -i 127.0.0.1 -W tmux new -A -s ccfly-ttyd claude
