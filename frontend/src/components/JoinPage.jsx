import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'

function JoinPage() {
  const { roomId } = useParams()
  const [connectionStatus, setConnectionStatus] = useState('Initializing...')
  const [cameraPermission, setCameraPermission] = useState('pending')
  const localVideoRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const websocketRef = useRef(null)
  const localStreamRef = useRef(null)
  const clientId = useRef(`phone-${Date.now()}`)

  useEffect(() => {
    initializeCamera()
    return () => {
      cleanup()
    }
  }, [])

  const cleanup = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
    }
    if (websocketRef.current) {
      websocketRef.current.close()
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
    }
  }

  const initializeCamera = async () => {
    try {
      setConnectionStatus('Requesting camera permission...')
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment' // Use back camera if available
        },
        audio: false 
      })
      
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }
      
      setCameraPermission('granted')
      setConnectionStatus('Camera ready! Connecting to room...')
      
      // Initialize WebSocket after getting camera
      initializeWebSocket()
      
    } catch (error) {
      console.error('Error accessing camera:', error)
      setCameraPermission('denied')
      setConnectionStatus('Camera permission denied')
    }
  }

  const initializeWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    
    websocketRef.current = new WebSocket(wsUrl)

    websocketRef.current.onopen = () => {
      console.log('WebSocket connected')
      setConnectionStatus('Connected to server. Joining room...')
      
      // Join room as phone
      websocketRef.current.send(JSON.stringify({
        type: 'join',
        roomId: roomId,
        clientId: clientId.current,
        clientType: 'phone'
      }))
    }

    websocketRef.current.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      console.log('Received message:', message)

      switch (message.type) {
        case 'user-joined':
          if (message.clientType === 'desktop') {
            setConnectionStatus('Desktop connected! Setting up video call...')
            await initializePeerConnection()
            await createOffer()
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
          setConnectionStatus('Desktop disconnected')
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

    // Add local stream to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnectionRef.current.addTrack(track, localStreamRef.current)
      })
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
        setConnectionStatus('Video streaming to desktop!')
      } else if (peerConnectionRef.current.connectionState === 'disconnected') {
        setConnectionStatus('Disconnected from desktop')
      }
    }
  }

  const createOffer = async () => {
    if (peerConnectionRef.current) {
      const offer = await peerConnectionRef.current.createOffer()
      await peerConnectionRef.current.setLocalDescription(offer)

      websocketRef.current.send(JSON.stringify({
        type: 'offer',
        offer: offer
      }))
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
      <h2>Phone Camera</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <p><strong>Room ID:</strong> {roomId}</p>
        <p><strong>Status:</strong> {connectionStatus}</p>
        <p><strong>Camera:</strong> {cameraPermission}</p>
      </div>

      {cameraPermission === 'denied' && (
        <div style={{ color: 'red', marginBottom: '20px' }}>
          <p>Camera permission is required to stream video.</p>
          <button onClick={initializeCamera}>Try Again</button>
        </div>
      )}

      <div style={{ marginTop: '20px' }}>
        <h3>Your Camera</h3>
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            maxWidth: '480px',
            height: 'auto',
            border: '2px solid #333',
            backgroundColor: '#000',
            transform: 'scaleX(-1)' // Mirror the video for better UX
          }}
        />
      </div>

      <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
        <p>Keep this page open to stream your camera to the desktop.</p>
        <p>Make sure your phone and desktop are on the same network or use HTTPS.</p>
      </div>
    </div>
  )
}

export default JoinPage