# WebRTC Multi‑Object Detection — Technical Design Report

## 1) Design Choices
- **Dual execution modes (WASM and Server):**
  - **WASM (default):** In‑browser inference with TensorFlow.js to minimize end‑to‑end (E2E) latency, eliminate server compute, and enable offline/local operation on typical laptops without GPUs.
  - **Server mode:** Centralizes inference with ONNX Runtime (CPU) for consistent throughput across clients and to offload weak client devices; accepts higher network and encode/decode overhead.
- **Model selection:**
  - **WASM:** SSD‑MobileNet‑V2 TFJS for fast, lightweight multi‑object detection with good speed/accuracy on CPUs.
  - **Server:** YOLOv5n ONNX for compact yet accurate detection with stable CPU performance.
- **Input resolution and sampling:** Inputs are downscaled (e.g., 320×240 in low‑resource mode) and frames are sampled at an interval to align compute cost with latency targets.
- **Frame queue handling:** A single‑slot queue (latest‑frame wins) avoids backlog; old frames are dropped when compute is busy so the overlay reflects the most recent video.
- **WebRTC setup:**
  - WebSocket signaling creates/join rooms and exchanges offers/answers/ICE.
  - P2P connection carries the phone’s camera stream to the desktop.
  - Frame timestamps are preserved and used to align detections with the rendered video frame for stable overlays.

## 2) Low‑Resource Strategy (Laptop without GPU)
- **Downscaled input:** Process 320×240 (or similar) tensors to keep per‑frame cost low and sustain interactive FPS.
- **Frame thinning:** Run inference on every Nth frame (e.g., 2–4× thinning) while rendering video at native rate; HUD interpolates between detections.
- **Quantized/lightweight models:** Prefer TFJS models with smaller backbones or 8‑bit quantization where available to reduce CPU cycles and memory bandwidth.
- **CPU usage management:**
  - Limit parallelism to prevent thread oversubscription.
  - Use timers tied to processing budget (e.g., skip if previous inference not finished).
  - Keep pre/post‑processing cache‑friendly (typed arrays, reuse buffers).

## 3) Backpressure / Queue Policy
- **Policy:** Keep a queue length of 1; when a new frame arrives during ongoing inference, replace the queued frame and discard older ones.
- **Rationale:** Prevents ever‑growing latency from backlogs and maintains real‑time behavior even under load.
- **Effect on UX:** Detections remain temporally close to the displayed video at the expense of skipping stale frames; overall E2E latency stays bounded.

## 4) Metrics Interpretation (from metrics.json)
- Source: metrics/sample_metrics.json
- **E2E latency (median):** 45.2 ms — Indicates strong responsiveness suitable for interactive overlays.
- **E2E latency (p95):** 78.9 ms — Tail latency remains well under 100 ms, minimizing jitter.
- **Processed FPS:** 28 — Near‑real‑time detection cadence with smooth overlay updates.
- **Uplink bandwidth:** 12 kbps — Low upstream (signaling/metadata overhead is minimal; inference local in WASM).
- **Downlink bandwidth:** 850 kbps — Typical for receiving the phone’s camera stream over WebRTC at modest resolution/bitrate.
- **CPU usage:** Not present in the current metrics file; recommend adding `cpu_pct` to summary and optional `cpuSamples` for time‑series analysis.

## 5) Next‑Step Improvement
- **Adaptive sampling and bitrate targeting:** Dynamically adjust input resolution, frame thinning, and WebRTC encoder bitrate using live metrics to hit a user‑defined latency budget (e.g., maintain p95 < 150 ms). This preserves UX under variable device and network conditions.

## 6) Summary
The system prioritizes real‑time responsiveness through lightweight models, downscaled inputs, and an overwrite queue, while offering a server‑side path for consistent performance. Reported metrics show low median and tail latency with near‑30 FPS overlays, validating the design for interactive, multi‑object detection from phone to desktop.