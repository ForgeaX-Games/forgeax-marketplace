#!/usr/bin/env bash
# character-editor 启动脚本
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/node20/bin:$PATH"

# LLM key 文件放在工程外（避免污染 git workspace），character-editor 的
# llm-key-loader.ts 认 LLM_KEY_JSON_PATH 环境变量作为最高优先路径。
export LLM_KEY_JSON_PATH="/data/workspace/.secrets/character-editor-llm-key.json"

PORT="${PORT:-15173}"
LOG="server.log"
PID_FILE=".server.pid"

_running_pid() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    cat "$PID_FILE"; return 0
  fi
  ss -tlnpH "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true
}

case "${1:-bg}" in
  fg) exec npm run dev ;;
  bg)
    if pid=$(_running_pid) && [[ -n "${pid:-}" ]]; then echo "⚠ 已在运行 pid=$pid"; exit 0; fi
    nohup npm run dev >"$LOG" 2>&1 < /dev/null & disown
    echo $! > "$PID_FILE"; sleep 3
    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "✓ 已启动 pid=$(cat "$PID_FILE")"
      echo "  http://localhost:$PORT/"
    else
      echo "✕ 启动失败"; tail -20 "$LOG"; exit 1
    fi
    ;;
  stop)
    pid=$(_running_pid || true); [[ -z "${pid:-}" ]] && { echo "（未运行）"; exit 0; }
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || echo "$pid")
    kill -TERM -- "-$pgid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8; do sleep 0.4; kill -0 "$pid" 2>/dev/null || break; done
    kill -0 "$pid" 2>/dev/null && { kill -KILL -- "-$pgid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true; }
    rm -f "$PID_FILE"; echo "✓ 已停止 pid=$pid" ;;
  restart) "$0" stop; "$0" bg ;;
  status)
    pid=$(_running_pid || true)
    if [[ -n "${pid:-}" ]]; then echo "✓ 运行中 pid=$pid  http://localhost:$PORT/"
    else echo "（未运行）"; fi ;;
  *) echo "Usage: $0 [fg|bg|stop|restart|status]"; exit 1 ;;
esac
