import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'

function JoinPage() {
  const { roomId } = useParams()
  const [status, setStatus] = useState('Init')
  const localVideoRef = useRef(null)
  const pcRef = useRef(null)
  const wsRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    (async () => {
      try {
        setStatus('Requesting camera...')
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        console.log('[Phone] Local stream captured', stream)
        streamRef.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
          console.log('[Phone] Local preview attached to video element')
        }
        setStatus('Camera ready, connecting...')
        initWS()
      } catch (e) {
        console.error('getUserMedia error', e)
        setStatus('Camera permission denied')
      }
    })()

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      wsRef.current?.close()
      pcRef.current?.close()
    }
  }, [])

  const initWS = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    wsRef.current = new WebSocket(wsUrl)

    wsRef.current.onopen = async () => {
      console.log('WS connected')
      wsRef.current?.send(JSON.stringify({ type: 'join', role: 'phone', roomId }))
      await ensurePC()
      await createAndSendOffer()
    }

    wsRef.current.onmessage = async (e) => {
      const msg = JSON.parse(e.data)
      console.log('WS message', msg)
      if (msg.type === 'answer') {
        await handleAnswer(msg)
      } else if (msg.type === 'ice-candidate') {
        await addIce(msg.candidate)
      }
    }

    wsRef.current.onerror = (e) => {
      console.error('WS error', e)
      setStatus('Connection error')
    }
  }

  const ensurePC = async () => {
    if (pcRef.current) return
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    pcRef.current = pc

    // Add local tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => {
        pc.addTrack(t, streamRef.current)
        console.log('[Phone] Track added to RTCPeerConnection', t.kind)
      })
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const { candidate, sdpMid, sdpMLineIndex } = ev.candidate
        wsRef.current?.send(JSON.stringify({
          type: 'ice-candidate',
          roomId,
          candidate: { candidate, sdpMid, sdpMLineIndex },
        }))
      }

    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('Streaming to desktop')
    }
  }

  const createAndSendOffer = async () => {
    const pc = pcRef.current
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    wsRef.current?.send(JSON.stringify({ type: 'offer', roomId, sdp: offer.sdp, descType: offer.type }))
    console.log('Offer sent', offer)
  }

const pendingCandidates = []

const addIce = async (candidate) => {
  if (!candidate) return
  if (pcRef.current?.remoteDescription) {
    await pcRef.current.addIceCandidate(candidate)
  } else {
    pendingCandidates.push(candidate)
  }
}

const handleAnswer = async ({ sdp }) => {
  await pcRef.current.setRemoteDescription({ type: 'answer', sdp })
  // Flush queued candidates
  while (pendingCandidates.length) {
    await pcRef.current.addIceCandidate(pendingCandidates.shift())
  }
}


  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
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
        style={{ width: '100%', maxWidth: 480, border: '2px solid #333', background: '#000' }}
      />
    </div>
  )
}

export default JoinPage