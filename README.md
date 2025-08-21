# WebRTC Multi-Object Detection

A real-time WebRTC system that streams video from a phone to a laptop browser for object detection.

## Phase 2: WebRTC Phone → Browser Streaming

This implementation provides WebRTC streaming from phone camera to desktop browser with Python backend signaling.

### Setup Instructions

#### 1. Backend Setup (FastAPI + WebSocket Signaling)

```bash
# Navigate to server directory
cd server

# Install dependencies (if venv not already set up)
pip install -r requirements.txt

# Start the FastAPI server
uvicorn main:app --host 0.0.0.0 --port 8000
```

#### 2. Frontend Setup (React + Vite)

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Build the frontend
npm run build
```

#### 3. Expose Server with ngrok (for HTTPS access from phone)

```bash
# Install ngrok if not already installed
# Download from https://ngrok.com/download

# Expose the server
ngrok http 8000
```

### Usage Instructions

#### Quick Start (Recommended)

1. **One-command startup:**
   ```bash
   # WASM mode (default) - detection runs in browser
   ./start.sh wasm
   
   # Server mode - detection runs on Python backend
   ./start.sh server
   ```

2. **In another terminal, expose with ngrok:**
   ```bash
   ngrok http 8000
   ```
   Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

3. **Open desktop browser:**
   - Go to the ngrok HTTPS URL
   - You'll see a QR code and room ID

4. **Connect phone:**
   - Scan the QR code with your phone
   - Grant camera permission
   - Your phone's camera stream will appear on the desktop

#### Manual Setup (Alternative)

1. **Install backend dependencies:**
   ```bash
   cd server
   pip install -r requirements.txt
   ```

2. **Start the backend server:**
   ```bash
   cd server
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

3. **Frontend is pre-built** (static HTML with inline React)
   - No build step required
   - Files are in `frontend/dist/`

4. **Expose with ngrok:**
   ```bash
   ngrok http 8000
   ```

5. **Test the connection:**
   - Desktop: Open ngrok URL in browser
   - Phone: Scan QR code or visit `/join/{roomId}` URL

### Architecture

- **Frontend (React):**
  - `/` - Desktop viewer page with QR code
  - `/join/:roomId` - Phone camera page
  - WebRTC PeerConnection for video streaming
  - WebSocket for signaling

- **Backend (FastAPI):**
  - Serves static files from `frontend/dist`
  - WebSocket endpoint `/ws` for signaling
  - Manages rooms and peer connections
  - Forwards SDP offers/answers and ICE candidates

### Features

- ✅ QR code generation for easy phone connection (with fallback)
- ✅ WebRTC peer-to-peer video streaming
- ✅ WebSocket signaling server
- ✅ Room-based connections
- ✅ Responsive design for mobile and desktop
- ✅ Connection status indicators
- ✅ Automatic camera permission handling
- ✅ High-quality video streaming (640x480@30fps)
- ✅ Natural camera view (no mirroring)
- ✅ Enhanced debugging and error handling
- ✅ Real-time object detection with bounding boxes
- ✅ Live metrics (FPS, latency, bandwidth)
- ✅ 30-second benchmark with metrics.json export
- ✅ Dual detection modes: WASM (browser) and Server (Python)

### Detection Modes

#### WASM Mode (Default)
- Object detection runs in the browser using TensorFlow.js
- Lightweight SSD MobileNet v2 model
- No server-side processing required
- Lower latency for inference

#### Server Mode
- Object detection runs on Python backend using ONNX Runtime
- YOLOv5n quantized model for CPU inference
- Frames sent via WebSocket for processing
- Results returned with timing metadata

### Mode Selection

```bash
# Start in WASM mode (browser-based detection)
./start.sh wasm

# Start in Server mode (Python backend detection)
./start.sh server

# Docker Compose with mode selection
MODE=wasm docker-compose up
MODE=server docker-compose up
```

### Benchmarking

Run 30-second performance benchmarks:

```bash
# Benchmark WASM mode
./bench/run_bench.sh --duration 30 --mode wasm

# Benchmark Server mode  
./bench/run_bench.sh --duration 30 --mode server
```

Metrics are automatically exported to `metrics.json` with:
- End-to-end latency (median & P95)
- Processed FPS
- Bandwidth utilization
- Per-frame detection samples

### Troubleshooting

1. **Camera not working on phone:**
   - Ensure you're using HTTPS (ngrok provides this)
   - Check browser permissions for camera access

2. **WebSocket connection fails:**
   - Verify the server is running on port 8000
   - Check that ngrok is properly forwarding requests

3. **Video not appearing on desktop:**
   - Check browser console for WebRTC errors
   - Ensure both devices are connected to the signaling server
   - Try refreshing both pages

### Dependencies

**Frontend:**
- React 19.1.1
- React Router DOM 7.1.1
- QRCode 1.5.4
- Vite 7.1.2

**Backend:**
- FastAPI 0.115.6
- Uvicorn 0.34.0
- WebSockets 14.1
- ONNX Runtime 1.19.0 (Server mode)
- NumPy 1.26.4 (Server mode)
- Pillow 10.5.0 (Server mode)