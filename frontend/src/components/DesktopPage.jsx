import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'

function DesktopPage() {
  const [roomId, setRoomId] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('Waiting for connection...')
  const videoRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const websocketRef = useRef(null)
  const clientId = useRef(`desktop-${Date.now()}`)

  useEffect(() => {
    // Generate unique room ID
    const newRoomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    setRoomId(newRoomId)

    // Generate QR code
    const joinUrl = `${window.location.origin}/join/${newRoomId}`
    QRCode.toDataURL(joinUrl)
      .then(url => setQrCodeUrl(url))
      .catch(err => console.error('Error generating QR code:', err))

    // Initialize WebSocket connection
    initializeWebSocket(newRoomId)

    return () => {
      if (websocketRef.current) {
        websocketRef.current.close()
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close()
      }
    }
  }, [])

  const initializeWebSocket = (roomId) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    
    websocketRef.current = new WebSocket(wsUrl)

    websocketRef.current.onopen = () => {
      console.log('WebSocket connected')
      // Join room as desktop
      websocketRef.current.send(JSON.stringify({
        type: 'join',
        roomId: roomId,
        clientId: clientId.current,
        clientType: 'desktop'
      }))
    }

    websocketRef.current.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      console.log('Received message:', message)

      switch (message.type) {
        case 'user-joined':
          if (message.clientType === 'phone') {
            setConnectionStatus('Phone connected! Setting up video...')
            await initializePeerConnection()
          }
          break
        case 'offer':
          await handleOffer(message.offer)
          break
        case 'answer':
          await handleAnswer(message.answer)
          break
        case 'ice-candidate':
          await handleIceCandidate(message.candidate)
          break
        case 'user-left':
          setConnectionStatus('Phone disconnected. Waiting for connection...')
          if (videoRef.current) {
            videoRef.current.srcObject = null
          }
          break
      }
    }

    websocketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error)
      setConnectionStatus('Connection error')
    }
  }

  const initializePeerConnection = async () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }

    peerConnectionRef.current = new RTCPeerConnection(configuration)

    // Handle incoming stream
    peerConnectionRef.current.ontrack = (event) => {
      console.log('Received remote stream')
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0]
        setConnectionStatus('Video stream active!')
      }
    }

    // Handle ICE candidates
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        websocketRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate
        }))
      }
    }

    // Handle connection state changes
    peerConnectionRef.current.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnectionRef.current.connectionState)
      if (peerConnectionRef.current.connectionState === 'connected') {
        setConnectionStatus('Connected!')
      } else if (peerConnectionRef.current.connectionState === 'disconnected') {
        setConnectionStatus('Disconnected')
      }
    }
  }

  const handleOffer = async (offer) => {
    if (!peerConnectionRef.current) {
      await initializePeerConnection()
    }

    await peerConnectionRef.current.setRemoteDescription(offer)
    const answer = await peerConnectionRef.current.createAnswer()
    await peerConnectionRef.current.setLocalDescription(answer)

    websocketRef.current.send(JSON.stringify({
      type: 'answer',
      answer: answer
    }))
  }

  const handleAnswer = async (answer) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(answer)
    }
  }

  const handleIceCandidate = async (candidate) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.addIceCandidate(candidate)
    }
  }

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>WebRTC Multi-Object Detection</h1>
      <h2>Desktop Viewer</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <p><strong>Room ID:</strong> {roomId}</p>
        <p><strong>Status:</strong> {connectionStatus}</p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Scan QR Code with Phone</h3>
        {qrCodeUrl && (
          <img 
            src={qrCodeUrl} 
            alt="QR Code" 
            style={{ border: '1px solid #ccc', padding: '10px' }}
          />
        )}
        <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
          Or visit: {window.location.origin}/join/{roomId}
        </p>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3>Video Stream</h3>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            maxWidth: '640px',
            height: 'auto',
            border: '2px solid #333',
            backgroundColor: '#000'
          }}
        />
      </div>
    </div>
  )
}

export default DesktopPage