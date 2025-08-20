// frontend/src/components/DesktopPage.jsx
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
function drawDummyBoxes(ctx, width, height) {
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = 'red'
  ctx.lineWidth = 3
  ctx.font = '16px Arial'
  ctx.fillStyle = 'red'

  const boxes = [
    { x: width * 0.1, y: height * 0.2, w: 100, h: 80, label: 'Object 1' },
    { x: width * 0.5, y: height * 0.3, w: 120, h: 100, label: 'Object 2' },
    { x: width * 0.3, y: height * 0.6, w: 150, h: 90, label: 'Object 3' },
  ]

  boxes.forEach(b => {
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillText(b.label, b.x, b.y - 5)
  })
}
function DesktopPage() {
  const [roomId, setRoomId] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('Waiting for connection...')
  const videoRef = useRef(null)
  const canvasRef = useRef(null) // ✅ added
  const peerConnectionRef = useRef(null)
  const websocketRef = useRef(null)
  const roomIdRef = useRef('') // avoid stale closures

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
    }
  }, [])
// useEffect(() => {
//   if (!pc) return
//   pc.ontrack = (event) => {
//     console.log('[Desktop] ontrack fired')
//     if (videoRef.current) {
//       videoRef.current.srcObject = event.streams[0]
//       console.log('[Desktop] Video stream attached')
//     }
//   }
// }, [pc])
// === Canvas overlay effect ===
useEffect(() => {
  const video = videoRef.current
  const canvas = canvasRef.current
  if (!video || !canvas) return

  const ctx = canvas.getContext('2d')

  function resizeCanvas() {
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
  }

  function render() {
    if (video.videoWidth && video.videoHeight) {
      resizeCanvas()
      drawDummyBoxes(ctx, canvas.width, canvas.height)
    }
    requestAnimationFrame(render)
  }

  console.log('[Desktop] Canvas overlay initialized')
  render()
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
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0]
        console.log('[Desktop] videoRef.srcObject assigned (ontrack)')
        const v = videoRef.current
        const tryPlay = () => v.play().catch(() => setTimeout(tryPlay, 300))
        // Try both immediate play and on metadata
        tryPlay()
        v.onloadedmetadata = () => tryPlay()
        setConnectionStatus('Streaming')
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
          <p style={{ color: '#fff' }}><strong>Status:</strong> {connectionStatus}</p>
        </div>


        {/* Main video viewer */}
        <div style={{ width: '100%', marginBottom: 16 }}>
          {/* <div style={{ position: 'relative', display: 'inline-block' }}> */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              style={{
                width: '100%',
                // maxWidth: 640,
                borderRadius: 8,
                background: '#000',
                height: 'auto',
                maxHeight: '70vh',
                border: '2px solid #333',
                transform: 'scaleX(-1)', // ✅ fix mirrored video
              }}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
              }}
            />
          {/* </div> */}

            
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
