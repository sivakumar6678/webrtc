// frontend/src/components/JoinPage.jsx
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'

function JoinPage() {
  const { roomId } = useParams()
  const [status, setStatus] = useState('Init')

  const localVideoRef = useRef(null)
  const pcRef = useRef(null)
  const wsRef = useRef(null)
  const streamRef = useRef(null)
  const pendingCandidatesRef = useRef([])

    useEffect(() => {
    // Just request camera first
    ;(async () => {
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
      } catch (e) {
        console.error('[Phone] getUserMedia error', e)
        setStatus('Camera permission denied or unavailable')
      }
    })()

    return () => {
      try {
        streamRef.current?.getTracks().forEach(t => t.stop())
        wsRef.current?.close()
        pcRef.current?.close()
      } catch {}
    }
  }, [roomId])




  const initWS = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = async () => {
      console.log('[Phone] WS connected')
      ws.send(JSON.stringify({ type: 'join', role: 'phone', roomId }))
      await ensurePC()
      await createAndSendOffer()
    }

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data)
      console.log('[Phone] WS message', msg)
      if (msg.type === 'answer') {
        await handleAnswer(msg)
      } else if (msg.type === 'ice-candidate') {
        await addRemoteIce(msg.candidate)
      }
    }

    ws.onerror = (e) => {
      console.error('[Phone] WS error', e)
      setStatus('Connection error')
    }
  }

    const handleConnect = () => {
    if (!streamRef.current) {
      setStatus('Camera not ready')
      return
    }
    setStatus('Connecting...')
    initWS()
  }


  const ensurePC = async () => {
    if (pcRef.current) return

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc

    // Add local tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, streamRef.current)
        console.log('[Phone] Track added to RTCPeerConnection', track.kind)
      })
      console.log('[Phone] Local stream ready (tracks added)')
    }

    // Outgoing ICE to desktop via WS
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current?.send(JSON.stringify({
          type: 'ice-candidate',
          roomId,
          candidate: event.candidate,
        }))
      }
    }

    pc.onconnectionstatechange = () => {
      console.log('[Phone] PC state:', pc.connectionState)
      if (pc.connectionState === 'connected') setStatus('Streaming to desktop')
    }
  }

  const createAndSendOffer = async () => {
    const pc = pcRef.current
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    wsRef.current?.send(JSON.stringify({
      type: 'offer',
      roomId,
      sdp: offer.sdp,
      descType: offer.type,
    }))
    console.log('[Phone] Offer created & sent')
  }

  const addRemoteIce = async (candidate) => {
    if (!candidate) return
    const pc = pcRef.current
    if (!pc) {
      pendingCandidatesRef.current.push(candidate)
      return
    }
    if (pc.remoteDescription) {
      try {
        await pc.addIceCandidate(candidate)
      } catch (e) {
        console.warn('[Phone] addIceCandidate failed', e)
      }
    } else {
      pendingCandidatesRef.current.push(candidate)
    }
  }

  const handleAnswer = async ({ sdp }) => {
    const pc = pcRef.current
    await pc.setRemoteDescription({ type: 'answer', sdp })
    console.log('[Phone] Remote answer set')
    // Flush queued ICE
    while (pendingCandidatesRef.current.length) {
      const c = pendingCandidatesRef.current.shift()
      try {
        await pc.addIceCandidate(c)
      } catch (e) {
        console.warn('[Phone] addIceCandidate (queued) failed', e)
      }
    }
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
          border: '2px solid #333',
          background: '#000',
          borderRadius: 8,
          transform: 'scaleX(-1)', // mirror fix
        }}
      />
      <div style={{ marginTop: 16 }}>
        <button
          onClick={handleConnect}
          style={{
            padding: '10px 20px',
            background: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 16,
            cursor: 'pointer',
          }}
        >
          Connect
        </button>
      </div>

    </div>
  )
}

export default JoinPage
