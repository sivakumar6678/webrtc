# Real-time WebRTC Multi-Object Detection Task

## Goal
Build a system where:
- A phone streams its camera to a laptop browser (via WebRTC).
- The laptop browser displays the live video and overlays bounding boxes + labels for detected objects.
- The system supports two modes:
  1. **WASM mode (required)** — detection runs inside browser (onnxruntime-web / tfjs-wasm).
  2. **Server mode (optional)** — detection runs in Python backend (onnxruntime CPU), results returned as JSON.
- The system collects metrics (latency, FPS, bandwidth) and saves them into `metrics.json`.

---

## Key Requirements

1. **Phone → Browser streaming**
   - Laptop shows QR code with join link.
   - Phone opens link → grants camera access.
   - Video stream appears in laptop browser.

2. **Detection + Overlay**
   - Run object detection on video frames.
   - Draw bounding boxes + labels on canvas overlay in browser.

3. **Modes**
   - **WASM Mode (default)**:
     - Detection runs in browser using WebAssembly (onnxruntime-web or tfjs-wasm).
     - Must run on modest hardware (e.g., 8GB RAM, i5 CPU).
   - **Server Mode (bonus)**:
     - Phone → Browser → Python backend (FastAPI + aiortc).
     - Backend runs detection on CPU (onnxruntime).
     - Sends detection JSON back to browser to overlay.

4. **Metrics**
   - **FPS processed** (frames per second that end with overlays).
   - **Latency**:
     - End-to-End latency = `overlay_display_ts - capture_ts`.
     - Collect median (p50) and 95th percentile (p95).
   - **Bandwidth** (uplink & downlink in kbps).
   - Save into `metrics.json`.

5. **One-command run**
   - `./start.sh wasm` → launches app in WASM mode.
   - `./start.sh server` → launches app in Server mode.

6. **Deliverables**
   - Working demo (phone → browser + overlays).
   - `metrics.json` with FPS, p50 & p95 latency, bandwidth.
   - `README.md` with setup & usage instructions.
   - Loom video: demo + metrics.json + one improvement idea.

---

## Build Phases (do in order)

### Phase 2: WebRTC (Phone → Browser stream)
- Desktop shows QR code with join URL.
- Phone scans → opens join page → shares camera.
- Laptop receives and displays video in `<video>`.

### Phase 3: Overlay pipeline
- Add `<canvas>` above `<video>`.
- Draw dummy rectangle for testing overlays.

### Phase 4: WASM detection
- Integrate `onnxruntime-web` or `tfjs-wasm`.
- Use a lightweight model (SSD MobileNet v2, YOLOv5n/YOLOv8n quantized).
- Downscale frames (e.g., 320×240).
- Run detection on every Nth frame (avoid lag).
- Draw bounding boxes + labels.

### Phase 5: Latency + FPS HUD
- Assign each frame a `frame_id` + `capture_ts`.
- Compute:
  - FPS = processed frames / second.
  - E2E latency = `overlay_display_ts - capture_ts`.
- Display FPS + latency live on screen.

### Phase 6: Metrics.json
- Script to run 30s test.
- Collect FPS, p50, p95 latency, bandwidth.
- Save as `metrics/metrics.json`.

### Phase 7: Server mode (optional, bonus)
- Backend (Python + aiortc):
  - Receive frames from browser.
  - Run onnxruntime CPU detection.
  - Return results as JSON via DataChannel/WebSocket.
- Browser overlays results using same JSON contract.

### Phase 8: Docker + Final Polish
- Add `Dockerfile` + `docker-compose.yml`.
- One-command run via `./start.sh`.
- Support both modes.

---

## Evaluation Criteria
- ✅ Functionality: Phone stream → Laptop overlays working.
- ⚡ Latency: Low E2E delay (<500ms p95).
- 🔄 Robustness: Backpressure handling (drop old frames).
- 📄 Documentation: Clear README, reproducible setup.
- 💡 Reasoning: Explain trade-offs & improvements in Loom video.
