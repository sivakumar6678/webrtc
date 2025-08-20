// frontend/src/components/HUD.jsx
// Real-time HUD overlay for metrics display

import { useState, useEffect } from 'react'

function HUD({ metrics, style = {} }) {
  const [isVisible, setIsVisible] = useState(true)
  
  // Toggle HUD visibility with keyboard shortcut
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'h' && e.ctrlKey) {
        setIsVisible(!isVisible)
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isVisible])
  
  if (!isVisible) {
    return (
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        zIndex: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        color: '#fff',
        padding: '5px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontFamily: 'monospace',
        cursor: 'pointer',
        ...style
      }} onClick={() => setIsVisible(true)}>
        📊 HUD (Ctrl+H)
      </div>
    )
  }
  
  return (
    <div style={{
      position: 'absolute',
      top: '10px',
      left: '10px',
      zIndex: 10,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      color: '#fff',
      padding: '12px',
      borderRadius: '8px',
      fontSize: '14px',
      fontFamily: 'monospace',
      minWidth: '200px',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      backdropFilter: 'blur(4px)',
      ...style
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
        paddingBottom: '4px'
      }}>
        <span style={{ fontWeight: 'bold', color: '#00ff00' }}>📊 LIVE METRICS</span>
        <button
          onClick={() => setIsVisible(false)}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 4px'
          }}
        >
          ✕
        </button>
      </div>
      
      {/* FPS */}
      <div style={{ marginBottom: '6px' }}>
        <span style={{ 
          color: metrics.isLowFps ? '#ff4444' : '#00ff00',
          fontWeight: 'bold'
        }}>
          FPS: {metrics.fps}
          {metrics.isLowFps && <span style={{ color: '#ff4444', marginLeft: '8px' }}>⚠️ LOW FPS</span>}
        </span>
      </div>
      
      {/* Latency */}
      <div style={{ marginBottom: '6px' }}>
        <div style={{ color: '#ffff00' }}>
          <strong>Latency:</strong>
        </div>
        <div style={{ fontSize: '12px', marginLeft: '8px' }}>
          <div>p50: <span style={{ color: '#fff' }}>{metrics.latency.median.toFixed(1)}ms</span></div>
          <div>p95: <span style={{ color: '#fff' }}>{metrics.latency.p95.toFixed(1)}ms</span></div>
        </div>
      </div>
      
      {/* Bandwidth */}
      <div style={{ marginBottom: '4px' }}>
        <div style={{ color: '#00ffff' }}>
          <strong>Bandwidth:</strong>
        </div>
        <div style={{ fontSize: '12px', marginLeft: '8px' }}>
          <div>↓ <span style={{ color: '#fff' }}>{metrics.bandwidth.downlink} kbps</span></div>
          <div>↑ <span style={{ color: '#fff' }}>{metrics.bandwidth.uplink} kbps</span></div>
        </div>
      </div>
      
      {/* Footer */}
      <div style={{
        fontSize: '10px',
        color: '#888',
        marginTop: '8px',
        paddingTop: '4px',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        textAlign: 'center'
      }}>
        Ctrl+H to toggle • Updates every 1s
      </div>
    </div>
  )
}

export default HUD