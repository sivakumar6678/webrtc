#!/usr/bin/env bash
set -euo pipefail

DURATION=30
MODE="wasm"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)
      DURATION="$2"; shift 2 ;;
    --mode)
      MODE="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "[bench] Starting $DURATION sec bench in mode=$MODE"

# Start server if not running (reuse start.sh)
/home/sivakumar/Documents/Projects/webrtc/start.sh "$MODE" &
SERVER_WRAPPER_PID=$!

echo "[bench] Waiting server warmup (5s)..."
sleep 5

echo "[bench] Please open the app in browser (if not auto-opened), connect the phone, then click 'Start 30s Bench' on Desktop UI."
echo "[bench] This helper just ensures server is up; metrics.json will be downloaded by the browser."

echo "[bench] Press Ctrl+C to stop when finished."
wait $SERVER_WRAPPER_PID