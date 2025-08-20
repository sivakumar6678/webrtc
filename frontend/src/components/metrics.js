// frontend/src/components/metrics.js
// Real-time HUD metrics tracking and calculations

export class MetricsTracker {
  constructor() {
    // Moving averages configuration
    this.maxSamples = 30 // Last 30 samples for smoothing
    
    // FPS tracking
    this.fpsHistory = []
    this.lastFpsTime = performance.now()
    this.fpsFrameCount = 0
    
    // Latency tracking (end-to-end detection latency)
    this.latencyHistory = []
    
    // Bandwidth tracking
    this.bandwidthHistory = []
    this.lastBandwidthCheck = performance.now()
    this.lastBytesReceived = 0
    this.lastBytesSent = 0
    
    // Current smoothed values
    this.currentFps = 0
    this.currentLatency = { median: 0, p95: 0 }
    this.currentBandwidth = { uplink: 0, downlink: 0 }
    
    // Console logging interval
    this.lastConsoleLog = performance.now()
    this.consoleLogInterval = 5000 // 5 seconds
    
    // WebRTC stats reference
    this.peerConnection = null
  }
  
  // Set WebRTC peer connection for bandwidth stats
  setPeerConnection(pc) {
    this.peerConnection = pc
  }
  
  // Update FPS counter
  updateFPS() {
    this.fpsFrameCount++
    const now = performance.now()
    const elapsed = now - this.lastFpsTime
    
    if (elapsed >= 1000) { // Calculate FPS every second
      const fps = Math.round((this.fpsFrameCount * 1000) / elapsed)
      
      // Add to history and maintain max samples
      this.fpsHistory.push(fps)
      if (this.fpsHistory.length > this.maxSamples) {
        this.fpsHistory.shift()
      }
      
      // Calculate smoothed FPS (moving average)
      this.currentFps = this.calculateMovingAverage(this.fpsHistory)
      
      // Reset counters
      this.fpsFrameCount = 0
      this.lastFpsTime = now
    }
  }
  
  // Add latency measurement (in milliseconds)
  addLatency(latencyMs) {
    this.latencyHistory.push(latencyMs)
    if (this.latencyHistory.length > this.maxSamples) {
      this.latencyHistory.shift()
    }
    
    // Calculate median and p95
    if (this.latencyHistory.length > 0) {
      const sorted = [...this.latencyHistory].sort((a, b) => a - b)
      const median = this.calculatePercentile(sorted, 50)
      const p95 = this.calculatePercentile(sorted, 95)
      
      this.currentLatency = { median, p95 }
    }
  }
  
  // Update bandwidth stats from WebRTC
  async updateBandwidth() {
    if (!this.peerConnection) return
    
    try {
      const stats = await this.peerConnection.getStats()
      const now = performance.now()
      const elapsed = now - this.lastBandwidthCheck
      
      if (elapsed < 1000) return // Update at most once per second
      
      let bytesReceived = 0
      let bytesSent = 0
      
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
          bytesReceived += report.bytesReceived || 0
        } else if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
          bytesSent += report.bytesSent || 0
        }
      })
      
      // Calculate bandwidth in kbps
      if (this.lastBytesReceived > 0 && elapsed > 0) {
        const downlinkKbps = Math.round(((bytesReceived - this.lastBytesReceived) * 8) / (elapsed / 1000) / 1000)
        const uplinkKbps = Math.round(((bytesSent - this.lastBytesSent) * 8) / (elapsed / 1000) / 1000)
        
        // Add to history
        this.bandwidthHistory.push({ uplink: uplinkKbps, downlink: downlinkKbps })
        if (this.bandwidthHistory.length > this.maxSamples) {
          this.bandwidthHistory.shift()
        }
        
        // Calculate smoothed bandwidth
        if (this.bandwidthHistory.length > 0) {
          const avgUplink = this.calculateMovingAverage(this.bandwidthHistory.map(b => b.uplink))
          const avgDownlink = this.calculateMovingAverage(this.bandwidthHistory.map(b => b.downlink))
          
          this.currentBandwidth = { 
            uplink: Math.max(0, avgUplink), 
            downlink: Math.max(0, avgDownlink) 
          }
        }
      }
      
      // Update tracking variables
      this.lastBytesReceived = bytesReceived
      this.lastBytesSent = bytesSent
      this.lastBandwidthCheck = now
      
    } catch (error) {
      console.warn('[Metrics] Bandwidth stats failed:', error)
      // Fallback to approximate values
      this.currentBandwidth = { uplink: 0, downlink: 500 } // Approximate 500kbps downlink
    }
  }
  
  // Get current metrics for HUD display
  getMetrics() {
    return {
      fps: this.currentFps,
      latency: this.currentLatency,
      bandwidth: this.currentBandwidth,
      isLowFps: this.currentFps < 1
    }
  }
  
  // Console logging every 5 seconds
  logMetrics() {
    const now = performance.now()
    if (now - this.lastConsoleLog >= this.consoleLogInterval) {
      const metrics = this.getMetrics()
      
      console.log('[HUD Metrics]', {
        fps: `${metrics.fps} FPS`,
        latency: `${metrics.latency.median.toFixed(1)}ms (p95: ${metrics.latency.p95.toFixed(1)}ms)`,
        bandwidth: `↓${metrics.bandwidth.downlink}kbps ↑${metrics.bandwidth.uplink}kbps`,
        samples: {
          fps: this.fpsHistory.length,
          latency: this.latencyHistory.length,
          bandwidth: this.bandwidthHistory.length
        }
      })
      
      this.lastConsoleLog = now
    }
  }
  
  // Helper: Calculate moving average
  calculateMovingAverage(values) {
    if (values.length === 0) return 0
    const sum = values.reduce((acc, val) => acc + val, 0)
    return Math.round(sum / values.length)
  }
  
  // Helper: Calculate percentile
  calculatePercentile(sortedValues, percentile) {
    if (sortedValues.length === 0) return 0
    
    const index = (percentile / 100) * (sortedValues.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    
    if (lower === upper) {
      return sortedValues[lower]
    }
    
    const weight = index - lower
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
  }
  
  // Export metrics for Phase 6 (future use)
  exportMetrics() {
    return {
      timestamp: new Date().toISOString(),
      fps: {
        current: this.currentFps,
        history: [...this.fpsHistory]
      },
      latency: {
        current: this.currentLatency,
        history: [...this.latencyHistory]
      },
      bandwidth: {
        current: this.currentBandwidth,
        history: [...this.bandwidthHistory]
      },
      samples: {
        fps: this.fpsHistory.length,
        latency: this.latencyHistory.length,
        bandwidth: this.bandwidthHistory.length
      }
    }
  }
}

// Create singleton instance
export const metricsTracker = new MetricsTracker()