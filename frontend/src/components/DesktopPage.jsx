// frontend/src/components/DesktopPage.jsx
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { detector, drawDetections } from './detection.js'
import { metricsTracker } from './metrics.js'
import HUD from './HUD.jsx'
function DesktopPage() {
  const [roomId, setRoomId] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('Waiting for connection...')
  
  // Detection states
  const [modelStatus, setModelStatus] = useState('Loading model...')
  const [detectionStatus, setDetectionStatus] = useState('Waiting for video...')
  const [fps, setFps] = useState(0)
  const [detectionCount, setDetectionCount] = useState(0)
  const [rawDetectionCount, setRawDetectionCount] = useState(0)
  const [memoryInfo, setMemoryInfo] = useState({ numTensors: 0, numBytes: 0 })
  
  // HUD metrics state
  const [hudMetrics, setHudMetrics] = useState({
    fps: 0,
    latency: { median: 0, p95: 0 },
    bandwidth: { uplink: 0, downlink: 0 },
    isLowFps: false
  })
  
  // Video orientation and mirroring state
  const [videoOrientation, setVideoOrientation] = useState('landscape') // 'portrait' or 'landscape'
  const [isVideoMirrored, setIsVideoMirrored] = useState(false) // Track if video needs mirroring
  const [cameraType, setCameraType] = useState('unknown') // 'front', 'back', or 'unknown'
  
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const websocketRef = useRef(null)
  const roomIdRef = useRef('') // avoid stale closures
  
  // Detection refs
  const isDetectionRunning = useRef(false)
  const lastFrameTime = useRef(performance.now())
  const frameCount = useRef(0)
  const lastDetections = useRef([])
  const detectionLatency = useRef(0)
  const fpsFrameCount = useRef(0)
  const lastFpsTime = useRef(performance.now())

  // Phase 6: Metrics collection store (in-memory)
  const metricsStoreRef = useRef({
    fps: [], // per-second samples
    latencyMs: [], // per-frame model latency fallback
    e2eLatencyMs: [], // per-frame E2E latency: overlay_display_ts - capture_ts
    detectionCountPerFrame: [],
    detectionsByFrame: []
  })
  const frameIndexRef = useRef(0)
  const currentFpsRef = useRef(0)
  const processedFramesRef = useRef(0)

  // Bench mode timestamp sync
  const lastCaptureTsRef = useRef(0)
  const lastCaptureFrameRef = useRef(0)
  const benchRunningRef = useRef(false)

  useEffect(() => {
    // Generate roomId
    const newRoomId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setRoomId(newRoomId)
    roomIdRef.current = newRoomId

    // Generate QR for phone join URL
    const joinUrl = `${window.location.origin}/join/${newRoomId}`
    QRCode.toDataURL(joinUrl)
      .then(url => setQrCodeUrl(url))
      .catch(err => console.error('[Desktop] QR error:', err))

    // Initialize WebSocket
    initializeWebSocket(newRoomId)

    // Start HUD metrics update interval
    const metricsInterval = setInterval(() => {
      const metrics = metricsTracker.getMetrics()
      setHudMetrics(metrics)
      metricsTracker.logMetrics() // Console logging every 5s
      
      // Log live metrics updates occasionally
      if (Math.random() < 0.1) { // Log ~10% of updates
        console.log('[Desktop] Live metrics updated:', {
          fps: metrics.fps,
          latency: `${metrics.latency.median}ms (p95: ${metrics.latency.p95}ms)`,
          bandwidth: `↓${metrics.bandwidth.downlink}kbps ↑${metrics.bandwidth.uplink}kbps`
        })
      }
    }, 1000) // Update HUD every 1s

    return () => {
      websocketRef.current?.close()
      peerConnectionRef.current?.close()
      isDetectionRunning.current = false
      clearInterval(metricsInterval)
    }
  }, [])

  // Initialize object detection model
  useEffect(() => {
    const initializeDetection = async () => {
      try {
        setModelStatus('Loading TensorFlow.js...')
        
        console.log('[Desktop] Initializing TensorFlow.js detection')
        
        // Initialize with TensorFlow.js SSD MobileNet v2
        const result = await detector.initialize()

        if (result.success) {
          setModelStatus('✅ SSD MobileNet v2 loaded')
          setDetectionStatus('Real-time TensorFlow.js detection ready')
          console.log('[Desktop] Object detection ready:', result.message)
        } else {
          setModelStatus('❌ Model failed to load')
          setDetectionStatus(`Model error: ${result.message}`)
          console.error('[Desktop] Model load failed:', result.message)
        }

      } catch (error) {
        console.error('[Desktop] Detection initialization failed:', error)
        setModelStatus('❌ Model load failed')
        setDetectionStatus(`Detection error: ${error.message}`)
      }
    }

    initializeDetection()
  }, [])

// === Canvas overlay with real object detection ===
useEffect(() => {
  const video = videoRef.current
  const canvas = canvasRef.current
  if (!video || !canvas) return

  const ctx = canvas.getContext('2d')
  isDetectionRunning.current = true

  function resizeCanvas() {
    // Set canvas internal resolution to match fixed video size (640×480)
    canvas.width = 640
    canvas.height = 480

    // Canvas display size is fixed to match video element (640×480)
    canvas.style.width = '640px'
    canvas.style.height = '480px'
    
    // Log canvas size update for debugging alignment
    console.log('[Desktop] Canvas resized for centered layout:', {
      canvasInternal: `${canvas.width}×${canvas.height}`,
      canvasDisplay: `${canvas.style.width}×${canvas.style.height}`,
      videoElement: `640px×480px`,
      videoStream: `${video.videoWidth}×${video.videoHeight}`
    })
    
    // Detect and update video orientation
    if (video.videoWidth && video.videoHeight) {
      const newOrientation = video.videoWidth > video.videoHeight ? 'landscape' : 'portrait'
      
      if (newOrientation !== videoOrientation) {
        setVideoOrientation(newOrientation)
        console.log('[Desktop] Video orientation changed to:', newOrientation, `(${video.videoWidth}×${video.videoHeight}) -> Canvas: 640×480`)
      }
    }
  }

  // FPS calculation - integrated with metrics tracker
  function updateFPS() {
    // Update metrics tracker FPS
    metricsTracker.updateFPS()
    
    // Legacy FPS for existing UI (keep for compatibility)
    fpsFrameCount.current++
    const now = performance.now()
    const elapsed = now - lastFpsTime.current
    
    if (elapsed >= 1000) { // Update every second
      const currentFps = Math.round((fpsFrameCount.current * 1000) / elapsed)
      const safeFps = currentFps > 0 ? currentFps : 1
      currentFpsRef.current = safeFps
      setFps(safeFps) // Avoid 0 FPS display
      // Phase 6: store per-second FPS sample
      metricsStoreRef.current.fps.push(safeFps)

      fpsFrameCount.current = 0
      lastFpsTime.current = now
      
      // Update memory info periodically
      if (detector.isLoaded) {
        setMemoryInfo(detector.getMemoryInfo())
      }
    }
  }

  // Main rendering and detection loop
  async function render() {
    if (!isDetectionRunning.current) return
    
    if (video.videoWidth && video.videoHeight) {
      resizeCanvas()
      updateFPS()
      
      // Update bandwidth metrics
      metricsTracker.updateBandwidth()

      // Always try to run detection if model is loaded and video is ready
      if (video.readyState >= 2) {
        try {
          let detectionResult
          
          if (detector.isLoaded) {
            // Use SSD MobileNet v2 with confidence threshold >= 0.8
            const detectionStart = performance.now()
            detectionResult = await detector.detect(video, 300, 300, 0.8)
            const detectionEnd = performance.now()
            const endToEndLatency = detectionEnd - detectionStart
            
            // Update metrics tracker with latency
            metricsTracker.addLatency(endToEndLatency)
            
            if (detectionResult.latency) {
              detectionLatency.current = detectionResult.latency
            } else {
              detectionLatency.current = endToEndLatency
            }
            
            // Handle skipped frames (for performance)
            if (detectionResult.skipped) {
              // Don't update detection status for skipped frames
            } else if (detectionResult.error) {
              console.warn('[Desktop] Detection error:', detectionResult.error)
              setDetectionStatus(`Error: ${detectionResult.error}`)
            } else {
              const detections = detectionResult.detections || []
              
              // Update raw detection count (before filtering)
              setRawDetectionCount(detectionResult.rawCount || detections.length)
              
              // Store detections for drawing
              if (detections.length > 0) {
                lastDetections.current = detections
                setDetectionCount(detections.length)
                
                const modelType = 'SSD MobileNet v2'
                setDetectionStatus(`✅ ${modelType}: ${detections.length} objects`)
                
                // Enhanced logging with raw vs filtered detections
                const sampleDetections = detections.slice(0, 3).map(d => `${d.className} (${(d.confidence * 100).toFixed(1)}%)`)
                console.log(`[Desktop] ${modelType} detection results:`, {
                  raw: detectionResult.rawCount || 0,
                  filtered: detectionResult.filteredCount || 0,
                  final: detections.length,
                  samples: sampleDetections,
                  latency: `${detectionLatency.current.toFixed(1)}ms`,
                  fps: fps,
                  memory: `${memoryInfo.numTensors} tensors`,
                  frameSkip: `every ${detector.detectionInterval} frames`
                })
                
              } else {
                setDetectionCount(0)
                setDetectionStatus('🔍 Scanning for objects...')
              }
            }
          } else {
            // Model not loaded - show error on canvas
            setDetectionStatus('❌ Model not loaded')
          }

        } catch (error) {
          console.error('[Desktop] Detection failed:', error)
          setDetectionStatus(`Detection error: ${error.message}`)
        }
      }

      // Always draw latest detections (even if not running detection this frame)
      drawDetections(
        ctx,
        lastDetections.current,
        video.videoWidth,
        video.videoHeight,
        canvas.width,
        canvas.height,
        videoOrientation,
        isVideoMirrored
      )

      // Phase 6: collect per-frame metrics in memory
      const objectsMap = {}
      for (const d of lastDetections.current) {
        const key = d.className || 'unknown'
        objectsMap[key] = (objectsMap[key] || 0) + 1
      }
      // E2E latency: overlay_display_ts - capture_ts
      const displayTs = performance.now()
      const captureTs = lastCaptureTsRef.current || displayTs
      const e2e = Math.max(0, displayTs - captureTs)
      metricsStoreRef.current.e2eLatencyMs.push(e2e)

      metricsStoreRef.current.latencyMs.push(Number(detectionLatency.current) || 0)
      metricsStoreRef.current.detectionCountPerFrame.push(lastDetections.current.length)
      metricsStoreRef.current.detectionsByFrame.push({
        frame: frameIndexRef.current + 1,
        objects: objectsMap
      })
      frameIndexRef.current += 1
      // Count processed frames (frames drawn with detections overlay)
      processedFramesRef.current += 1
    }

    if (isDetectionRunning.current) {
      requestAnimationFrame(render)
    }
  }

  console.log('[Desktop] Canvas overlay with detection initialized (centered layout)')
  render()

  return () => {
    isDetectionRunning.current = false
  }
}, [])



  const initializeWebSocket = (rid) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    const ws = new WebSocket(wsUrl)
    websocketRef.current = ws

    ws.onopen = () => {
      console.log('[Desktop] WS connected')
      ws.send(JSON.stringify({
        type: 'join',
        role: 'desktop',
        roomId: rid,
      }))
    }

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data)
      console.log('[Desktop] WS message:', msg)

      if (msg.type === 'offer') {
        await handleOffer(msg)
      } else if (msg.type === 'ice-candidate') {
        await handleIceCandidate(msg.candidate)
      } else if (msg.type === 'join' && msg.role === 'phone') {
        // Handle phone joining with camera type info
        if (msg.cameraType) {
          setCameraType(msg.cameraType)
          setIsVideoMirrored(msg.cameraType === 'front')
          console.log('[Desktop] Phone joined with camera type:', msg.cameraType)
        }
      } else if (msg.type === 'capture_ts') {
        // Phone periodically sends capture timestamps via WS fallback
        lastCaptureTsRef.current = msg.ts || performance.now()
        lastCaptureFrameRef.current = (lastCaptureFrameRef.current || 0) + 1
      }
    }

    ws.onerror = (e) => {
      console.error('[Desktop] WS error', e)
      setConnectionStatus('Connection error')
    }
  }

  const ensurePeer = async () => {
    if (peerConnectionRef.current) return
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    const pc = new RTCPeerConnection(configuration)
    peerConnectionRef.current = pc
    
    // Set peer connection for metrics tracking
    metricsTracker.setPeerConnection(pc)

    // Receive-only transceiver (desktop has no local tracks)
    pc.addTransceiver('video', { direction: 'recvonly' })
    console.log('[Desktop] Transceiver added (recvonly)')

    pc.ontrack = (event) => {
      console.log('[Desktop] Remote track received', event.streams)
      console.log('[Desktop] Number of streams:', event.streams.length)
      if (event.streams.length > 0) {
        console.log('[Desktop] First stream tracks:', event.streams[0].getTracks())
      }
      
      if (videoRef.current && event.streams.length > 0) {
        videoRef.current.srcObject = event.streams[0]
        console.log('[Desktop] videoRef.srcObject assigned (ontrack)')
        console.log('[Desktop] Video element:', videoRef.current)
        
        const v = videoRef.current
        const tryPlay = () => {
          v.play()
            .then(() => {
              console.log('[Desktop] Video playback started successfully')
              setConnectionStatus('✅ Video streaming')
            })
            .catch((error) => {
              console.warn('[Desktop] Video play failed, retrying in 300ms:', error)
              setTimeout(tryPlay, 300)
            })
        }
        
        // Try both immediate play and on metadata
        tryPlay()
        v.onloadedmetadata = () => {
          console.log('[Desktop] Video metadata loaded')
          tryPlay()
        }
        
        v.onloadeddata = () => {
          console.log('[Desktop] Video data loaded')
        }
        
        v.onplaying = () => {
          console.log('[Desktop] Video is playing')
          setConnectionStatus('✅ Video streaming')
        }
        
        v.onerror = (error) => {
          console.error('[Desktop] Video element error:', error)
          setConnectionStatus('❌ Video error')
        }
        
        setConnectionStatus('📡 Video connecting...')
      } else {
        console.warn('[Desktop] No video ref or no streams available')
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        websocketRef.current?.send(JSON.stringify({
          type: 'ice-candidate',
          roomId: roomIdRef.current,
          candidate: event.candidate,
        }))
      }
    }

       pc.onconnectionstatechange = () => {
      console.log('[Desktop] PC state:', pc.connectionState)
      if (pc.connectionState === 'connected') {
        setConnectionStatus('✅ Connected successfully')
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setConnectionStatus('❌ Phone disconnected')
        if (videoRef.current) {
          videoRef.current.srcObject = null
        }
      }
    }

  }

  const handleOffer = async ({ sdp }) => {
    await ensurePeer()
    const pc = peerConnectionRef.current
    await pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    websocketRef.current?.send(JSON.stringify({
      type: 'answer',
      roomId: roomIdRef.current,
      sdp: answer.sdp,
    }))
    console.log('[Desktop] Answer created & sent')
  }

  const handleIceCandidate = async (candidate) => {
    if (!candidate) return
    await ensurePeer()
    const pc = peerConnectionRef.current
    try {
      await pc.addIceCandidate(candidate)
    } catch (e) {
      console.warn('[Desktop] addIceCandidate failed', e)
    }
  }

  // Helper: compute percentile from array of numbers
  const percentile = (values, p) => {
    if (!values || values.length === 0) return 0
    const sorted = [...values].sort((a,b)=>a-b)
    const idx = (p/100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    const w = idx - lo
    return sorted[lo]*(1-w) + sorted[hi]*w
  }

  // Phase 6: Export metrics to JSON and trigger download
  const exportMetrics = (summaryOverride=null) => {
    const store = metricsStoreRef.current

    // Summary (bench-aware): if provided, use override; else derive basic summary
    const summary = summaryOverride || {
      e2e_latency_ms: {
        median: Number(percentile(store.e2eLatencyMs, 50).toFixed(1)),
        p95: Number(percentile(store.e2eLatencyMs, 95).toFixed(1))
      },
      fps_processed: currentFpsRef.current,
      uplink_kbps: hudMetrics.bandwidth.uplink,
      downlink_kbps: hudMetrics.bandwidth.downlink
    }

    const payload = {
      durationSec: benchRunningRef.current ? undefined : undefined,
      summary,
      samples: {
        fps: store.fps,
        latencyMs: store.latencyMs,
        e2eLatencyMs: store.e2eLatencyMs,
        detections: store.detectionsByFrame
      }
    }

    // Log summary before export
    const totalDetections = store.detectionCountPerFrame.reduce((a, b) => a + b, 0)
    console.log('[Export] Frames:', frameIndexRef.current)
    console.log('[Export] FPS samples:', store.fps.length)
    console.log('[Export] E2E Latency samples:', store.e2eLatencyMs.length)
    console.log('[Export] Total detections across frames:', totalDetections)

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'metrics.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Phase 6B: 30s bench runner (collect summary and export)
  const startBench = async (durationSec = 30) => {
    if (benchRunningRef.current) return
    benchRunningRef.current = true

    // Reset stores for a clean window
    metricsStoreRef.current.fps = []
    metricsStoreRef.current.latencyMs = []
    metricsStoreRef.current.e2eLatencyMs = []
    metricsStoreRef.current.detectionCountPerFrame = []
    metricsStoreRef.current.detectionsByFrame = []
    frameIndexRef.current = 0
    processedFramesRef.current = 0

    const start = performance.now()
    const endAt = start + durationSec * 1000

    // Poll bandwidth while running
    const bwTimer = setInterval(() => metricsTracker.updateBandwidth(), 1000)

    const benchTick = () => {
      if (!benchRunningRef.current) return
      if (performance.now() >= endAt) {
        clearInterval(bwTimer)
        benchRunningRef.current = false

        // Compute summary
        const e2e = metricsStoreRef.current.e2eLatencyMs
        const median = Number(percentile(e2e, 50).toFixed(1))
        const p95 = Number(percentile(e2e, 95).toFixed(1))
        const fpsProcessed = Math.round(processedFramesRef.current / durationSec)
        const { uplink, downlink } = metricsTracker.currentBandwidth

        const summary = {
          e2e_latency_ms: { median, p95 },
          fps_processed: fpsProcessed,
          uplink_kbps: uplink,
          downlink_kbps: downlink
        }

        const payload = {
          durationSec,
          summary,
          samples: {
            e2eLatencyMs: e2e,
            // Optional arrays
            fps: metricsStoreRef.current.fps,
            latencyMs: metricsStoreRef.current.latencyMs,
            detections: metricsStoreRef.current.detectionsByFrame
          }
        }

        // Export bench metrics.json
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'metrics.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        console.log('[Bench] Done:', payload)
        return
      }
      requestAnimationFrame(benchTick)
    }
    requestAnimationFrame(benchTick)
  }

  return (
    <div 
      className="video-wrapper" 
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100vw',
        height: '100vh',
        position: 'relative',
      }}
    >
      {/* Status Info Overlay - Top Left */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        zIndex: 10,
        color: '#fff',
        fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.8)',
        padding: '10px',
        borderRadius: '8px',
        maxWidth: '300px'
      }}>
        <div><strong>Room:</strong> {roomId}</div>
        <div><strong>Status:</strong> {connectionStatus}</div>
        <div><strong>Model:</strong> {modelStatus}</div>
        <div><strong>Detection:</strong> {detectionStatus}</div>
        <div>
          <strong>Orientation:</strong> {videoOrientation === 'portrait' ? '📱 Portrait' : '📺 Landscape'}
          {cameraType !== 'unknown' && ` | ${cameraType === 'front' ? '🤳 Front' : '📷 Back'}`}
          {isVideoMirrored && ' | 🪞 Mirrored'}
        </div>
      </div>

      {/* Live Metrics Overlay - Top Right (Outside Video Container) */}
      <div className="metrics" style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 3,
        fontSize: '14px',
        backgroundColor: 'rgba(0,0,0,0.9)',
        padding: '12px',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: 'white',
        fontFamily: 'monospace',
        minWidth: '220px'
      }}>
        <div style={{ color: '#00ff00', fontWeight: 'bold' }}>📊 LIVE METRICS</div>
        <div style={{ color: '#00ff00' }}>FPS: {fps}</div>
        <div style={{ color: '#ffff00' }}>Objects: {detectionCount}</div>
        <div style={{ color: '#ff99ff' }}>Raw: {rawDetectionCount}</div>
        <div style={{ color: '#00ffff' }}>Latency: {detectionLatency.current.toFixed(1)}ms</div>
        <div style={{ color: '#ff9900' }}>Tensors: {memoryInfo.numTensors}</div>
        <div style={{ color: '#ff6600' }}>Memory: {(memoryInfo.numBytes / 1024 / 1024).toFixed(1)}MB</div>
        <div style={{ color: '#00cccc' }}>↓{hudMetrics.bandwidth.downlink}kbps ↑{hudMetrics.bandwidth.uplink}kbps</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={exportMetrics} style={{
            background: '#1e90ff',
            color: 'white',
            border: 'none',
            padding: '6px 8px',
            borderRadius: '6px',
            cursor: 'pointer'
          }}>
            Download Metrics
          </button>
          <button onClick={() => startBench(30)} style={{
            background: '#00b894',
            color: 'white',
            border: 'none',
            padding: '6px 8px',
            borderRadius: '6px',
            cursor: 'pointer'
          }}>
            Start 30s Bench
          </button>
        </div>
      </div>

      {/* QR Code Overlay - Bottom Right */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        zIndex: 10,
        textAlign: 'center',
        backgroundColor: 'rgba(63, 56, 56, 0.8)',
        padding: '15px',
        borderRadius: '8px',
        color: '#fff'
      }}>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>Scan with phone</h4>
        {qrCodeUrl && (
          <img
            src={qrCodeUrl}
            alt="QR"
            style={{ 
              border: '1px solid #ccc', 
              padding: 5, 
              width: '160px', 
              height: '160px', 
              // borderRadius: 4,
              // backgroundColor: '#fff'
            }}
          />
        )}
        <p style={{ fontSize: 12, color: '#dbd8d8e8', margin: 5, maxWidth: '120px' }}>
          Or open: <a style={{ color: '#fffb00ff' }} href={`${window.location.origin}/join/${roomId}`} target="_blank" rel="noreferrer">
            {window.location.origin}/join/{roomId}
          </a>
        </p>
      </div>

      {/* Centered Video + Canvas Container - Perfect Alignment */}
      <div style={{ 
        position: 'relative',
        width: '640px',
        height: '480px'
      }}>
        {/* Placeholder when no video */}
        {connectionStatus === 'Waiting for connection...' && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 3,
            color: '#fff',
            fontSize: '18px',
            textAlign: 'center',
            background: 'rgba(0,0,0,0.7)',
            padding: '20px',
            borderRadius: '10px'
          }}>
            📱 Waiting for phone to connect...<br/>
            <small>Scan QR code in bottom right</small>
          </div>
        )}
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          controls={false}
          style={{
            width: '720px',
            height: '540px',
            borderRadius: 8,
            background: 'linear-gradient(45deg, #0d3ee0ff 25%, transparent 25%), linear-gradient(-45deg, #1a1a1aff 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f10000ff 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            border: '2px solid #333',
            // Apply transformations based on orientation and camera type
            transform: `
              ${videoOrientation === 'portrait' ? 'rotate(-90deg)' : ''} 
              ${isVideoMirrored ? 'scaleX(-1)' : ''}
            `.trim(),
            display: 'block',
            zIndex: 1,
            objectFit: 'cover'
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '720px',
            height: '540px',
            pointerEvents: 'none',
            zIndex: 2
          }}
        />
        
        {/* HUD Overlay */}
        <HUD metrics={hudMetrics} />
      </div>
      
      {/* Additional Live Metrics Display - Bottom Left (Outside Container) */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        left: 20,
        zIndex: 10,
        fontSize: '12px',
        backgroundColor: 'rgba(0,0,0,0.8)',
        padding: '8px 12px',
        borderRadius: '6px',
        color: 'white',
        fontFamily: 'monospace'
      }}>
        FPS: {fps} | Latency: {detectionLatency.current.toFixed(1)}ms | Objects: {detectionCount}
      </div>
    </div>
  )
}

export default DesktopPage
