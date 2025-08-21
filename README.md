# WebRTC Multi-Object Detection

A real-time system that streams a phone camera to a desktop browser via WebRTC and overlays multi-object detections on the video. The project supports in-browser inference (WASM) for low-resource machines and a server-backed mode for consistent performance.

---

## Overview
- Phone streams camera → Desktop receives via WebRTC.
- Detection runs either in the browser (TFJS) or on a Python server (ONNX Runtime).
- Overlays show bounding boxes and labels aligned to frames using timestamps.
- Heads-up display (HUD) reports FPS, end-to-end latency, and bandwidth; metrics can be exported.

---

## Features
- Two modes: `wasm` (in-browser) and `server` (backend inference).
- One-command launcher with Docker and optional ngrok tunnel.
- QR/URL flow for easy phone connection.
- Orientation/mirroring handling to keep overlays aligned.
- Benchmark script that saves `metrics.json` with latency, FPS, and bandwidth.

---

## Installation & Setup

### Prerequisites
- Docker and Docker Compose (recommended), or
- Python 3.10 and Node.js 18+ for local development
- Optional: `ngrok` for HTTPS access from a phone, `qrencode` for terminal QR

### Quick Start (Docker)
```bash
# Default (WASM mode)
./start.sh

# Server mode (backend inference)
./start.sh --mode server

# With public HTTPS tunnel
./start.sh --ngrok                 # default wasm
./start.sh --mode server --ngrok
```

### Local Development (no Docker)
- Backend (FastAPI + WebSocket signaling):
```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```
- Frontend (Vite build served by backend):
```bash
cd frontend
npm install
npm run build
```

### Environment
- `MODE=wasm|server` controls the active inference mode.
- Frontend build reads `VITE_MODE` derived from `MODE`.

### Models
- WASM (TFJS SSD MobileNet V2):
```bash
./download_ssd_model.sh
# or
./download_tfjs_model.sh
```
- Server (ONNX YOLOv5n): model available at `server/models/yolov5n.onnx`.

---

## Usage
1. Start the app using one of the commands above.
2. Open the desktop UI:
   - Docker: http://localhost:5173
   - Local dev: http://localhost:8000
3. Connect your phone:
   - With ngrok: scan the displayed QR or open the printed HTTPS URL on the phone.
   - Without ngrok: ensure the phone can reach the host over the LAN and use HTTPS if required by the browser.
4. Grant camera permissions on the phone to start streaming.
5. Observe detections and HUD metrics on the desktop.

### Switching Modes
```bash
./start.sh --mode wasm
./start.sh --mode server
```

---

## Metrics & Benchmarking
Run a timed benchmark and export metrics:
```bash
./bench/run_bench.sh --duration 30 --mode wasm
./bench/run_bench.sh --duration 30 --mode server
```
- At completion, a `metrics.json` file is saved with a summary of:
  - Median and P95 end-to-end latency (ms)
  - Processed FPS
  - Uplink and downlink bandwidth (kbps)
- Optional time-series samples may be included for deeper analysis.

---

## Troubleshooting
- No camera preview on phone:
  - Use HTTPS (e.g., ngrok) and verify camera permissions.
  - Confirm the signaling server is reachable.
- WebSocket errors:
  - Ensure port 8000 is accessible locally or via the tunnel.
- Overlay misalignment or rotation:
  - Keep the desktop canvas in landscape; input rotation and mirroring are handled in code.
- Low FPS / high CPU:
  - WASM: reduce input resolution, process every Nth frame, prefer local TFJS model files.
  - Server: lower input frame rate/resolution; ensure server CPU headroom.
- Docker checks:
  - Use `docker-compose ps` and `docker-compose logs -f` to diagnose container issues.

---

## Project Structure (High Level)
```
webrtc/
├─ start.sh                 # Launcher (Docker/local, ngrok, modes)
├─ docker-compose.yml       # Frontend (nginx) + server (FastAPI)
├─ bench/                   # Benchmark utilities
├─ frontend/                # React/Vite app and built assets
├─ server/                  # FastAPI app, signaling, optional inference
└─ metrics/                 # Example and exported metrics
```

---

## Script Reference
- `./start.sh` options:
  - `--mode wasm|server`
  - `--ngrok`
  - `--no-docker`
- `./bench/run_bench.sh` runs a timed benchmark and exports metrics.
- `./download_ssd_model.sh` and `./download_tfjs_model.sh` fetch local TFJS model files.