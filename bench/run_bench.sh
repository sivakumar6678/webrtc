#!/usr/bin/env bash
set -euo pipefail

DURATION=30
MODE="wasm"
METRICS_DIR="/home/sivakumar/Documents/Projects/webrtc/metrics"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)
      DURATION="$2"; shift 2 ;;
    --mode)
      MODE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Phase 6B Bench Runner - 30s benchmark with metrics.json export"
      echo ""
      echo "OPTIONS:"
      echo "  --duration SECONDS    Benchmark duration (default: 30)"
      echo "  --mode MODE          Detection mode: wasm|server (default: wasm)"
      echo "  --help, -h           Show this help message"
      echo ""
      echo "EXAMPLE:"
      echo "  $0 --duration 30 --mode wasm"
      echo "  $0 --duration 60 --mode server"
      echo ""
      echo "The script will:"
      echo "1. Start the WebRTC server in the specified mode"
      echo "2. Wait for you to connect your phone and start the bench"
      echo "3. Collect metrics for the specified duration"
      echo "4. Export metrics.json with E2E latency, FPS, and bandwidth data"
      exit 0 ;;
    *)
      echo "Unknown arg: $1"
      echo "Use --help for usage information"
      exit 1 ;;
  esac
done

echo "[bench] Starting ${DURATION}s bench in mode=${MODE}"
echo "[bench] Metrics will be saved to: ${METRICS_DIR}/metrics.json"

# Ensure metrics directory exists
mkdir -p "$METRICS_DIR"

# Start server if not running (reuse start.sh)
echo "[bench] Starting server in ${MODE} mode..."
/home/sivakumar/Documents/Projects/webrtc/start.sh "$MODE" &
SERVER_WRAPPER_PID=$!

echo "[bench] Waiting for server warmup (5s)..."
sleep 5

echo ""
echo "=========================================="
echo "🚀 BENCH RUNNER READY"
echo "=========================================="
echo "Duration: ${DURATION} seconds"
echo "Mode: ${MODE}"
echo "Metrics output: ${METRICS_DIR}/metrics.json"
echo ""
echo "📱 INSTRUCTIONS:"
echo "1. Open the app in browser (should auto-open)"
echo "2. Connect your phone by scanning the QR code"
echo "3. Wait for video stream to appear"
echo "4. Click 'Start ${DURATION}s Bench' button in the top-right metrics panel"
echo "5. The bench will run for ${DURATION} seconds and auto-download metrics.json"
echo ""
echo "📊 METRICS COLLECTED:"
echo "- E2E latency (median & p95) in ms"
echo "- Processed FPS (frames with detection overlays)"
echo "- Bandwidth (uplink & downlink in kbps)"
echo "- Per-frame detection samples"
echo ""
echo "Press Ctrl+C to stop the server when finished."
echo "=========================================="

# Keep server running
wait $SERVER_WRAPPER_PID