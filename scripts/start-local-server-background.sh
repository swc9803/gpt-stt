#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3010}"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/.local-server"

echo "[gpt-stt] $(date '+%Y-%m-%d %H:%M:%S') project: $PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "[gpt-stt] npm was not found in PATH."
  exit 1
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "[gpt-stt] node_modules is missing. Run npm install once in this project."
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[gpt-stt] port $PORT is already in use; leaving existing server alone."
  exit 0
fi

echo "[gpt-stt] starting local server on http://localhost:$PORT"
exec npm run dev
