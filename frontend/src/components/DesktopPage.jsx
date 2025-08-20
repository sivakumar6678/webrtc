// frontend/src/components/DesktopPage.jsx
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { detector, drawDetections } from './detection.js'
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

    return () => {
      websocketRef.current?.close()
      peerConnectionRef.current?.close()
      isDetectionRunning.current = false
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
    // Always force canvas to 1280×720 (landscape) for consistent desktop display
    canvas.width = 1280
    canvas.height = 720

    // Canvas display size matches video element size
    const videoRect = video.getBoundingClientRect()
    canvas.style.width = `${videoRect.width}px`
    canvas.style.height = `${videoRect.height}px`
    
    // Detect and update video orientation
    if (video.videoWidth && video.videoHeight) {
      const newOrientation = video.videoWidth > video.videoHeight ? 'landscape' : 'portrait'
      
      if (newOrientation !== videoOrientation) {
        setVideoOrientation(newOrientation)
        console.log('[Desktop] Video orientation changed to:', newOrientation, `(${video.videoWidth}×${video.videoHeight}) -> Canvas: 1280×720`)
      }
    }
  }

  // FPS calculation - fixed to avoid "0 FPS" bug
  function updateFPS() {
    fpsFrameCount.current++
    const now = performance.now()
    const elapsed = now - lastFpsTime.current
    
    if (elapsed >= 1000) { // Update every second
      const currentFps = Math.round((fpsFrameCount.current * 1000) / elapsed)
      setFps(currentFps > 0 ? currentFps : 1) // Avoid 0 FPS display
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

      // Always try to run detection if model is loaded and video is ready
      if (video.readyState >= 2) {
        try {
          let detectionResult
          
          if (detector.isLoaded) {
            // Use SSD MobileNet v2 with confidence threshold >= 0.8
            const detectionStart = performance.now()
            detectionResult = await detector.detect(video, 300, 300, 0.8)
            
            if (detectionResult.latency) {
              detectionLatency.current = detectionResult.latency
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
    }

    if (isDetectionRunning.current) {
      requestAnimationFrame(render)
    }
  }

  console.log('[Desktop] Canvas overlay with detection initialized')
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

  return (
    <div style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center' }}>Desktop Viewer</h2>

        <div style={{ marginBottom: 12, textAlign: 'center' }}>
          <p style={{ color: '#fff' }}><strong>Room:</strong> {roomId}</p>
          <p style={{ color: '#fff' }}><strong>Connection:</strong> {connectionStatus}</p>
          <p style={{ color: '#fff' }}><strong>Model:</strong> {modelStatus}</p>
          <p style={{ color: '#fff' }}><strong>Detection:</strong> {detectionStatus}</p>
          <p style={{ color: '#fff' }}>
            <strong>Orientation:</strong> {videoOrientation === 'portrait' ? '📱 Portrait' : '📺 Landscape'}
            {cameraType !== 'unknown' && ` | Camera: ${cameraType === 'front' ? '🤳 Front' : '📷 Back'}`}
            {isVideoMirrored && ' | 🪞 Mirrored'}
          </p>
        </div>

        {/* Performance metrics */}
        <div style={{ marginBottom: 12, textAlign: 'center', fontSize: '14px' }}>
          <div style={{ 
            display: 'inline-flex', 
            gap: '15px', 
            backgroundColor: 'rgba(0,0,0,0.8)', 
            padding: '10px 20px', 
            borderRadius: '8px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            <span style={{ color: '#00ff00' }}>FPS: {fps}</span>
            <span style={{ color: '#ffff00' }}>Objects: {detectionCount}</span>
            <span style={{ color: '#ff99ff' }}>Raw: {rawDetectionCount}</span>
            <span style={{ color: '#00ffff' }}>Latency: {detectionLatency.current.toFixed(1)}ms</span>
            <span style={{ color: '#ff9900' }}>Tensors: {memoryInfo.numTensors}</span>
            <span style={{ color: '#ff6600' }}>Memory: {(memoryInfo.numBytes / 1024 / 1024).toFixed(1)}MB</span>
          </div>
        </div>


        {/* Main video viewer - Always landscape display */}
        <div style={{ 
          width: '100%', 
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <div style={{ 
            position: 'relative', 
            display: 'inline-block',
            width: '100%',
            maxWidth: '100%',
            transition: 'all 0.3s ease'
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
                <small>Scan QR code below</small>
              </div>
            )}
            
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              controls={false}
              style={{
                width: '100%',
                height: 'auto',
                maxHeight: '70vh',
                minHeight: '300px',
                borderRadius: 8,
                background: 'linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)',
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
                objectFit: 'contain',
                transition: 'all 0.3s ease',
                // Adjust size when rotated from portrait to landscape
                ...(videoOrientation === 'portrait' && {
                  width: 'auto',
                  height: '70vh',
                  maxWidth: '100%',
                })
              }}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2,
                // Canvas is always 1280×720 but scales to match video display
                // transform: 'scaleX(-1)', // Don't mirror canvas - detections should align with video
              }}
            />
          </div>

            
        </div>

        {/* QR below video */}
        <div style={{ textAlign: 'center' }}>
          <h3>Scan with phone</h3>
          {qrCodeUrl && (
            <img
              src={qrCodeUrl}
              alt="QR"
              style={{ border: '1px solid #ccc', padding: 10, maxWidth: 256, width: '100%', height: 'auto', borderRadius: 8 }}
            />
          )}
          <p style={{ fontSize: 14, color: '#000000ff', marginTop: 10 }}>
            Or open: <a style={{ color: '#fffb00ff' }} href={`${window.location.origin}/join/${roomId}`} target="_blank" rel="noreferrer">
              {window.location.origin}/join/{roomId}
            </a>
          </p>

        </div>
      </div>
    </div>
  )
}

export default DesktopPage
