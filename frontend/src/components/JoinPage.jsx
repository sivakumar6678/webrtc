// frontend/src/components/JoinPage.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'

function JoinPage() {
  const { roomId } = useParams()
  const [status, setStatus] = useState('Init')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraOpened, setCameraOpened] = useState(false)

  const localVideoRef = useRef(null)
  const pcRef = useRef(null)
  const wsRef = useRef(null)
  const streamRef = useRef(null)
  const pendingCandidatesRef = useRef([])

  // Centralized cleanup
  const cleanupResources = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
    } catch (error) {
      console.warn('[Phone] Cleanup error:', error)
    }
  }
const startCamera = async () => {
  try {
    setStatus('Requesting camera...')
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
    console.log('[Phone] Local stream captured', stream)
    streamRef.current = stream
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream
      console.log('[Phone] Local preview attached to video element')
    }
    setStatus('Camera ready. Click connect to start.')
    return true
  } catch (e) {
    console.error('[Phone] getUserMedia error', e)
    setStatus('Camera permission denied or unavailable')
    return false
  }
}

  // 🔘 OPEN CAMERA (only when button clicked)
  const handleOpenCamera = async () => {
    try {
      setStatus('Requesting camera...')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false,
      })
      console.log('[Phone] Local stream captured', stream)
      streamRef.current = stream

      if (localVideoRef.current) {
        const videoEl = localVideoRef.current
        videoEl.srcObject = stream
        videoEl.muted = true
        videoEl.playsInline = true
        videoEl.autoplay = true

        videoEl.play().catch(err => {
          console.warn('Video autoplay blocked:', err)
        })
      }

      setCameraReady(true)
      setCameraOpened(true)
      setStatus('Camera ready. Now click Connect to stream.')
    } catch (error) {
      console.error('[Phone] getUserMedia error', error)
      setStatus('Camera permission denied or unavailable')
      setCameraReady(false)
      setCameraOpened(false)
    }
  }

  // 🔌 INIT WEBSOCKET + CONNECTION
  const initWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = async () => {
      console.log('[Phone] WebSocket connected')
      try {
        ws.send(JSON.stringify({ type: 'join', role: 'phone', roomId }))
        await setupPeerConnection()
        await createAndSendOffer()
      } catch (error) {
        console.error('[Phone] WebSocket setup error:', error)
        setStatus('Connection setup failed')
        setIsConnecting(false)
      }
    }

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)
        console.log('[Phone] WebSocket message received:', message)

        if (message.type === 'answer') {
          await handleAnswer(message)
        } else if (message.type === 'ice-candidate') {
          await addRemoteIceCandidate(message.candidate)
        }
      } catch (error) {
        console.error('[Phone] Message handling error:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('[Phone] WebSocket error:', error)
      setStatus('Connection error')
      setIsConnecting(false)
      setIsConnected(false)
    }

    ws.onclose = () => {
      console.log('[Phone] WebSocket closed')
      setIsConnected(false)
      setIsConnecting(false)
      setStatus('Disconnected')
    }
  }

// Disconnect + Connect Toggle
const handleConnect = async () => {
  if (status === "Streaming to desktop" || status === "Connecting...") {
    // 🔴 Disconnect
    setStatus("Disconnecting...")
    try {
      streamRef.current?.getTracks().forEach(t => t.stop())
      pcRef.current?.close()
      wsRef.current?.close()
    } catch {}

    pcRef.current = null
    wsRef.current = null
    streamRef.current = null
    pendingCandidatesRef.current = []

    setIsConnected(false)
    setIsConnecting(false)
    setStatus("Disconnected. Click Connect to start again.")
    return
  }

  // 🟢 Connect
  if (!streamRef.current) {
    const ok = await startCamera()
    if (!ok) return
  }

  setIsConnecting(true)
  setStatus('Connecting...')
  initWebSocket()   // ✅ FIXED: correct function name
}



  // 🔧 Peer connection setup, offer, ICE, etc. (same as your code)...
  const setupPeerConnection = async () => {
    if (pcRef.current) return

    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = peerConnection

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, streamRef.current)
          console.log('[Phone] Track added:', track.kind)
        })
      }

      peerConnection.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'ice-candidate',
            roomId,
            candidate: event.candidate,
          }))
        }
      }

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState
        console.log('[Phone] Connection state:', state)

        if (state === 'connected') {
          setStatus('Streaming to desktop')
          setIsConnected(true)
          setIsConnecting(false)
        } else if (['disconnected', 'failed', 'closed'].includes(state)) {
          setIsConnected(false)
          setIsConnecting(false)
          setStatus(state === 'failed' ? 'Connection failed' : 'Disconnected')
        }
      }
    } catch (error) {
      console.error('[Phone] Peer connection setup error:', error)
      setStatus('Peer connection setup failed')
      setIsConnecting(false)
    }
  }

  const createAndSendOffer = async () => {
    try {
      const peerConnection = pcRef.current
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          roomId,
          sdp: offer.sdp,
          descType: offer.type,
        }))
        console.log('[Phone] Offer sent')
      }
    } catch (error) {
      console.error('[Phone] Offer creation error:', error)
      setStatus('Failed to create offer')
      setIsConnecting(false)
    }
  }

  const addRemoteIceCandidate = async (candidate) => {
    if (!candidate) return
    const peerConnection = pcRef.current
    if (!peerConnection) {
      pendingCandidatesRef.current.push(candidate)
      return
    }

    if (peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(candidate)
      } catch (error) {
        console.warn('Failed to add ICE candidate:', error)
      }
    } else {
      pendingCandidatesRef.current.push(candidate)
    }
  }

  const handleAnswer = async ({ sdp }) => {
    try {
      const peerConnection = pcRef.current
      await peerConnection.setRemoteDescription({ type: 'answer', sdp })

      while (pendingCandidatesRef.current.length > 0) {
        const candidate = pendingCandidatesRef.current.shift()
        await peerConnection.addIceCandidate(candidate)
      }
    } catch (error) {
      console.error('[Phone] Answer handling error:', error)
      setStatus('Failed to process answer')
      setIsConnecting(false)
    }
  }

  const getButtonText = () => {
    if (isConnecting) return 'Connecting...'
    if (isConnected) return 'Disconnect'
    return 'Connect'
  }

  const getButtonColor = () => {
    if (isConnecting) return '#ffc107'
    if (isConnected) return '#dc3545'
    return '#007bff'
  }

  return (
    <div style={{ padding: 20, textAlign: 'center' }}>
      <h2>Phone Sender</h2>

      <div style={{ marginBottom: 12 }}>
        <p><strong>Room:</strong> {roomId}</p>
        <p><strong>Status:</strong> {status}</p>
      </div>

      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          maxWidth: 480,
          height: 'auto',
          border: '2px solid #333',
          background: '#000',
          borderRadius: 8,
          transform: 'scaleX(-1)',
          display: 'block',
          margin: '0 auto'
        }}
      />

      {/* 🔘 Open Camera Button */}
      <div style={{ marginTop: 16 }}>
        <button
          onClick={handleOpenCamera}
          disabled={cameraOpened}
          style={{
            padding: '12px 24px',
            background: cameraOpened ? '#6c757d' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 'bold',
            cursor: cameraOpened ? 'not-allowed' : 'pointer',
            marginRight: 12,
          }}
        >
          {cameraOpened ? 'Camera Opened' : 'Open Camera'}
        </button>

        {/* 🔌 Connect Button */}
        <button
          onClick={handleConnect}
          disabled={!cameraReady || isConnecting}
          style={{
            padding: '12px 24px',
            background: (!cameraReady || isConnecting) ? '#6c757d' : getButtonColor(),
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 'bold',
            cursor: (!cameraReady || isConnecting) ? 'not-allowed' : 'pointer',
            opacity: (!cameraReady || isConnecting) ? 0.6 : 1,
            transition: 'all 0.2s ease'
          }}
        >
          {getButtonText()}
        </button>
      </div>
    </div>
  )
}

export default JoinPage
