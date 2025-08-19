import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'

function DesktopPage() {
  const [roomId, setRoomId] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('Waiting for connection...')
  const videoRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const websocketRef = useRef(null)

  useEffect(() => {
    // Generate UUID-ish roomId
    const newRoomId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setRoomId(newRoomId)

    // Generate QR code for phone join URL
    const joinUrl = `${window.location.origin}/join/${newRoomId}`
    QRCode.toDataURL(joinUrl)
      .then(url => setQrCodeUrl(url))
      .catch(err => console.error('QR error:', err))

    // Initialize WebSocket
    initializeWebSocket(newRoomId)

    return () => {
      websocketRef.current?.close()
      peerConnectionRef.current?.close()
    }
  }, [])

  const initializeWebSocket = (rid) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    websocketRef.current = new WebSocket(wsUrl)

    websocketRef.current.onopen = () => {
      console.log('WS connected')
      websocketRef.current.send(JSON.stringify({
        type: 'join',
        role: 'desktop',
        roomId: rid,
      }))
    }

    websocketRef.current.onmessage = async (event) => {
      const msg = JSON.parse(event.data)
      console.log('WS message:', msg)

      if (msg.type === 'offer') {
        await handleOffer(msg)
      } else if (msg.type === 'ice-candidate') {
        await handleIceCandidate(msg.candidate)
      }
    }

    websocketRef.current.onerror = (e) => {
      console.error('WS error', e)
      setConnectionStatus('Connection error')
    }
  }

  const ensurePeer = async () => {
    if (peerConnectionRef.current) return
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    const pc = new RTCPeerConnection(configuration)
    peerConnectionRef.current = pc

    // Explicitly receive only (no local tracks on desktop)
    pc.addTransceiver('video', { direction: 'recvonly' })

    pc.ontrack = (event) => {
      console.log('Remote track received', event.streams)
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0]
        console.log('[Desktop] videoRef.srcObject assigned')
        // Ensure playback on some browsers
        const v = videoRef.current
        const tryPlay = () => v.play().catch(() => setTimeout(tryPlay, 300))
        v.onloadedmetadata = () => tryPlay()
        setConnectionStatus('Streaming')
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        websocketRef.current?.send(JSON.stringify({
          type: 'ice-candidate',
          roomId,
          candidate: event.candidate,
        }))
      }
    }

    pc.onconnectionstatechange = () => {
      console.log('PC state:', pc.connectionState)
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
      roomId,
      sdp: answer.sdp,
    }))
  }

  const handleIceCandidate = async (candidate) => {
    if (!candidate) return
    await ensurePeer()
    const pc = peerConnectionRef.current
    try {
      await pc.addIceCandidate(candidate)
    } catch (e) {
      console.warn('addIceCandidate failed', e)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center' }}>Desktop Viewer</h2>

        <div style={{ marginBottom: 12, textAlign: 'center' }}>
          <p><strong>Room:</strong> {roomId}</p>
          <p><strong>Status:</strong> {connectionStatus}</p>
        </div>

        {/* Video on top, responsive full width */}
        <div style={{ width: '100%', marginBottom: 16 }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: 'auto', maxHeight: '70vh', border: '2px solid #333', background: '#000' }}
          />
        </div>

        {/* QR below video */}
        <div style={{ textAlign: 'center' }}>
          <h3>Scan with phone</h3>
          {qrCodeUrl && (
            <img src={qrCodeUrl} alt="QR" style={{ border: '1px solid #ccc', padding: 10, maxWidth: 256, width: '100%', height: 'auto' }} />
          )}
          <p style={{ fontSize: 12, color: '#666', marginTop: 10 }}>
            Or open: {window.location.origin}/join/{roomId}
          </p>
        </div>
      </div>
    </div>
  )
}

export default DesktopPage