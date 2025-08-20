// frontend/src/components/detection.js
import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-webgl'
import * as cocoSsd from '@tensorflow-models/coco-ssd'

// COCO class names for object detection models
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop',
  'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush'
]

// Colors for different classes
const CLASS_COLORS = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080',
  '#FFC0CB', '#A52A2A', '#808080', '#000000', '#FFFFFF', '#90EE90', '#FFB6C1', '#87CEEB',
  '#DDA0DD', '#98FB98', '#F0E68C', '#FF6347', '#40E0D0', '#EE82EE', '#90EE90', '#FFB6C1'
]

class ObjectDetector {
  constructor() {
    this.model = null
    this.isLoaded = false
    this.loadError = null
    this.modelType = 'coco-ssd'
    this.frameCount = 0
    this.lastDetectionTime = 0
    this.detectionInterval = 3 // Detect every 3rd frame for performance
  }

  async initialize() {
    try {
      console.log('[Detection] Initializing TensorFlow.js...')
      
      // Set backend to WebGL for better performance
      await tf.setBackend('webgl')
      await tf.ready()
      
      console.log('[Detection] TensorFlow.js backend:', tf.getBackend())
      console.log('[Detection] TensorFlow.js version:', tf.version.tfjs)

      // Try to load SSD MobileNet v2 model from local path first
      const localModelUrl = '/models/ssd_mobilenet_v2/model.json'
      console.log('[Detection] Attempting to load SSD MobileNet v2 from local path:', localModelUrl)
      
      try {
        // First try to load from local path
        this.model = await tf.loadGraphModel(localModelUrl)
        
        console.log('[Detection] Local SSD MobileNet v2 model loaded successfully')
        console.log('[Detection] Model inputs:', this.model.inputs.map(input => ({
          name: input.name,
          shape: input.shape,
          dtype: input.dtype
        })))
        console.log('[Detection] Model outputs:', this.model.outputs.map(output => ({
          name: output.name,
          shape: output.shape,
          dtype: output.dtype
        })))

        this.modelType = 'ssd_mobilenet_v2_local'
        this.isLoaded = true
        this.loadError = null

        return { success: true, message: 'Local SSD MobileNet v2 model loaded successfully' }

      } catch (localModelError) {
        console.warn('[Detection] Failed to load local SSD MobileNet v2 model:', localModelError.message)
        console.log('[Detection] Falling back to COCO-SSD from CDN...')
        
        try {
          // Fallback to COCO-SSD model from CDN
          this.model = await cocoSsd.load({
            base: 'mobilenet_v2', // Explicitly use MobileNet v2
            modelUrl: undefined   // Use default CDN
          })
          
          console.log('[Detection] COCO-SSD (SSD MobileNet v2) model loaded successfully from CDN')
          console.log('[Detection] Model ready for inference')

          this.modelType = 'ssd_mobilenet_v2_cdn'
          this.isLoaded = true
          this.loadError = null

          return { success: true, message: 'SSD MobileNet v2 (COCO-SSD CDN) model loaded successfully' }

        } catch (cdnModelError) {
          console.error('[Detection] Failed to load COCO-SSD model from CDN:', cdnModelError.message)
          console.log('[Detection] All model loading attempts failed, detection will not work')
          
          // Don't fall back silently - show clear error
          this.modelType = 'failed'
          this.isLoaded = false
          this.loadError = `All model loading failed. Local: ${localModelError.message}. CDN: ${cdnModelError.message}`

          return { 
            success: false, 
            message: `Model loading failed. Local: ${localModelError.message}. CDN: ${cdnModelError.message}` 
          }
        }
      }

    } catch (error) {
      console.error('[Detection] Failed to initialize TensorFlow.js:', error)
      this.loadError = error.message
      this.isLoaded = false
      return { success: false, message: error.message }
    }
  }

  // Run inference on local TensorFlow.js model
  async runLocalModelInference(videoElement) {
    try {
      // Create tensor from video element
      const imageTensor = tf.browser.fromPixels(videoElement)
      
      // Resize to model input size (typically 300x300 for SSD MobileNet v2)
      const resized = tf.image.resizeBilinear(imageTensor, [300, 300])
      
      // Normalize to [0, 1] and add batch dimension
      const normalized = resized.div(255.0).expandDims(0)
      
      // Run inference
      const predictions = await this.model.predict(normalized)
      
      // Parse SSD output format
      const detections = await this.parseLocalModelOutput(predictions, videoElement.videoWidth, videoElement.videoHeight)
      
      // Clean up tensors
      imageTensor.dispose()
      resized.dispose()
      normalized.dispose()
      
      // Dispose prediction tensors if they're arrays
      if (Array.isArray(predictions)) {
        predictions.forEach(tensor => tensor.dispose())
      }
      
      return detections
      
    } catch (error) {
      console.error('[Detection] Local model inference failed:', error)
      return []
    }
  }

  // Parse local TensorFlow.js model output
  async parseLocalModelOutput(predictions, originalWidth, originalHeight) {
    const detections = []
    
    try {
      // SSD MobileNet v2 typically outputs:
      // - detection_boxes: [1, N, 4] - normalized coordinates [y1, x1, y2, x2]
      // - detection_classes: [1, N] - class indices
      // - detection_scores: [1, N] - confidence scores
      // - num_detections: [1] - number of valid detections
      
      let boxes, classes, scores, numDetections
      
      if (Array.isArray(predictions)) {
        // Handle array output format
        [boxes, classes, scores, numDetections] = predictions
      } else {
        // Handle object output format
        boxes = predictions['detection_boxes'] || predictions['boxes']
        classes = predictions['detection_classes'] || predictions['classes']
        scores = predictions['detection_scores'] || predictions['scores']
        numDetections = predictions['num_detections'] || predictions['num_detections']
      }

      if (!boxes || !classes || !scores) {
        console.warn('[Detection] Could not find required output tensors')
        return detections
      }

      // Get data from tensors
      const boxesData = await boxes.data()
      const classesData = await classes.data()
      const scoresData = await scores.data()
      const numDetectionsData = numDetections ? await numDetections.data() : [100]
      
      const maxDetections = Math.min(numDetectionsData[0] || 100, 100)
      
      for (let i = 0; i < maxDetections; i++) {
        const score = scoresData[i]
        
        if (score > 0.1) { // Basic threshold to avoid processing very low confidence detections
          // SSD outputs normalized coordinates [y1, x1, y2, x2]
          const y1 = boxesData[i * 4] * originalHeight
          const x1 = boxesData[i * 4 + 1] * originalWidth
          const y2 = boxesData[i * 4 + 2] * originalHeight
          const x2 = boxesData[i * 4 + 3] * originalWidth
          
          const classId = Math.round(classesData[i]) - 1 // Convert to 0-based index
          const className = COCO_CLASSES[classId] || `class_${classId}`
          
          detections.push({
            bbox: [x1, y1, x2 - x1, y2 - y1], // [x, y, width, height]
            score: score,
            confidence: score,
            classId: classId,
            class: className,
            className: className
          })
        }
      }
      
      return detections

    } catch (error) {
      console.error('[Detection] Error parsing local model output:', error)
      return detections
    }
  }

  // Apply Non-Maximum Suppression using TensorFlow.js
  async applyNMS(detections, iouThreshold = 0.5) {
    if (detections.length === 0) return detections
    
    try {
      // Prepare data for NMS
      const boxes = detections.map(d => [d.bbox[1], d.bbox[0], d.bbox[1] + d.bbox[3], d.bbox[0] + d.bbox[2]]) // Convert to [y1, x1, y2, x2]
      const scores = detections.map(d => d.score)
      
      // Convert to tensors
      const boxesTensor = tf.tensor2d(boxes, [boxes.length, 4])
      const scoresTensor = tf.tensor1d(scores)
      
      // Apply NMS
      const selectedIndices = await tf.image.nonMaxSuppressionAsync(
        boxesTensor,
        scoresTensor,
        10, // maxOutputSize
        iouThreshold,
        0.0 // scoreThreshold (already filtered)
      )
      
      // Get selected indices
      const indices = await selectedIndices.data()
      
      // Filter detections based on NMS results
      const nmsDetections = []
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i]
        nmsDetections.push(detections[idx])
      }
      
      // Clean up tensors
      boxesTensor.dispose()
      scoresTensor.dispose()
      selectedIndices.dispose()
      
      return nmsDetections
      
    } catch (error) {
      console.error('[Detection] NMS failed, returning original detections:', error)
      return detections
    }
  }

  // Main detection method with frame skipping for performance
  async detect(videoElement, targetWidth = 300, targetHeight = 300, confidenceThreshold = 0.8) {
    if (!this.isLoaded || !this.model) {
      return { 
        detections: [], 
        error: this.loadError || 'Model not loaded - check console for details',
        skipped: false
      }
    }

    // Increment frame counter
    this.frameCount++
    
    // Skip frames for performance (only detect every Nth frame)
    if (this.frameCount % this.detectionInterval !== 0) {
      return { detections: [], error: null, skipped: true }
    }

    try {
      const detectionStart = performance.now()
      
      let predictions = []
      
      if (this.modelType === 'ssd_mobilenet_v2_local') {
        // Handle local TensorFlow.js model
        predictions = await this.runLocalModelInference(videoElement)
      } else if (this.modelType === 'ssd_mobilenet_v2_cdn') {
        // Handle COCO-SSD model from CDN
        predictions = await this.model.detect(videoElement)
      } else {
        throw new Error(`Unknown model type: ${this.modelType}`)
      }
      
      const detectionEnd = performance.now()
      this.lastDetectionTime = detectionEnd - detectionStart
      
      // Filter predictions by confidence threshold
      const filteredDetections = predictions.filter(prediction => {
        const score = prediction.score || prediction.confidence || 0
        return score >= confidenceThreshold
      })
      
      console.log(`[Detection] Raw detections: ${predictions.length}, Filtered (>=${confidenceThreshold}): ${filteredDetections.length}`)
      
      // Convert to our standard format
      const detections = filteredDetections.map((prediction, index) => ({
        bbox: prediction.bbox || [prediction.x || 0, prediction.y || 0, prediction.width || 0, prediction.height || 0],
        confidence: prediction.score || prediction.confidence || 0,
        classId: prediction.classId !== undefined ? prediction.classId : COCO_CLASSES.indexOf(prediction.class),
        className: prediction.class || prediction.className || 'unknown',
        score: prediction.score || prediction.confidence || 0 // Keep original score for NMS
      }))
      
      // Apply Non-Maximum Suppression to remove duplicate boxes
      const nmsDetections = await this.applyNMS(detections, 0.5) // IoU threshold 0.5
      
      console.log(`[Detection] After NMS: ${nmsDetections.length} detections`)
      
      // Optionally filter to only "person" detections for cleaner output
      const personOnly = false // Set to true to only show person detections
      const finalDetections = personOnly 
        ? nmsDetections.filter(d => d.className === 'person')
        : nmsDetections

      return { 
        detections: finalDetections.slice(0, 10), // Limit to 10 detections
        error: null, 
        skipped: false, 
        latency: this.lastDetectionTime,
        rawCount: predictions.length,
        filteredCount: filteredDetections.length
      }

    } catch (error) {
      console.error('[Detection] Detection failed:', error)
      return { detections: [], error: error.message, skipped: false }
    }
  }

  // Get memory usage info
  getMemoryInfo() {
    return {
      numTensors: tf.memory().numTensors,
      numBytes: tf.memory().numBytes,
      unreliable: tf.memory().unreliable
    }
  }
}

// Helper function to draw detections on canvas with orientation handling
export function drawDetections(ctx, detections, videoWidth, videoHeight, canvasWidth, canvasHeight, videoOrientation = 'landscape', isVideoMirrored = false) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  
  // Show error message if model failed to load
  if (!detector.isLoaded && detector.loadError) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)'
    ctx.fillRect(10, 10, canvasWidth - 20, 80)
    ctx.fillStyle = 'white'
    ctx.font = 'bold 18px Arial'
    ctx.fillText('❌ Model failed to load', 20, 35)
    ctx.font = '14px Arial'
    ctx.fillText('Check console for details.', 20, 55)
    ctx.fillText('Network connection required for model download.', 20, 75)
    return
  }
  
  if (!detections || detections.length === 0) return

  ctx.font = '16px Arial'
  ctx.lineWidth = 2

  // Canvas is always 1280×720 (landscape)
  // We need to map video coordinates to canvas coordinates based on orientation
  
  let scaleX, scaleY, offsetX = 0, offsetY = 0
  
  if (videoOrientation === 'portrait' && videoHeight > videoWidth) {
    // Portrait video displayed in landscape canvas
    // Video is rotated 90° clockwise to fit landscape canvas
    
    // Calculate scale to fit rotated video in canvas
    const rotatedVideoWidth = videoHeight  // After rotation
    const rotatedVideoHeight = videoWidth  // After rotation
    
    const scaleToFitWidth = canvasWidth / rotatedVideoWidth
    const scaleToFitHeight = canvasHeight / rotatedVideoHeight
    const scale = Math.min(scaleToFitWidth, scaleToFitHeight)
    
    scaleX = scale
    scaleY = scale
    
    // Center the scaled video in canvas
    offsetX = (canvasWidth - rotatedVideoWidth * scale) / 2
    offsetY = (canvasHeight - rotatedVideoHeight * scale) / 2
    
    detections.forEach((detection, index) => {
      const { bbox, confidence, className, classId } = detection
      let [x, y, width, height] = bbox
      
      // Transform coordinates for 90° clockwise rotation
      // Original (x,y) in portrait -> (videoHeight - y - height, x) in landscape
      let rotatedX = (videoHeight - y - height) * scaleX + offsetX
      let rotatedY = x * scaleY + offsetY
      const rotatedWidth = height * scaleX
      const rotatedHeight = width * scaleY
      
      // Handle mirroring for rotated coordinates
      if (isVideoMirrored) {
        rotatedX = canvasWidth - rotatedX - rotatedWidth
      }
      
      drawBoundingBox(ctx, rotatedX, rotatedY, rotatedWidth, rotatedHeight, className, confidence, classId, index)
    })
    
  } else {
    // Landscape video: direct scaling to canvas
    const scaleToFitWidth = canvasWidth / videoWidth
    const scaleToFitHeight = canvasHeight / videoHeight
    const scale = Math.min(scaleToFitWidth, scaleToFitHeight)
    
    scaleX = scale
    scaleY = scale
    
    // Center the scaled video in canvas
    offsetX = (canvasWidth - videoWidth * scale) / 2
    offsetY = (canvasHeight - videoHeight * scale) / 2
    
    detections.forEach((detection, index) => {
      const { bbox, confidence, className, classId } = detection
      let [x, y, width, height] = bbox
      
      // Direct scaling for landscape
      let scaledX = x * scaleX + offsetX
      const scaledY = y * scaleY + offsetY
      const scaledWidth = width * scaleX
      const scaledHeight = height * scaleY
      
      // Handle mirroring for landscape coordinates
      if (isVideoMirrored) {
        scaledX = canvasWidth - scaledX - scaledWidth
      }
      
      drawBoundingBox(ctx, scaledX, scaledY, scaledWidth, scaledHeight, className, confidence, classId, index)
    })
  }
}

// Helper function to draw a single bounding box
function drawBoundingBox(ctx, x, y, width, height, className, confidence, classId, index) {
  // Choose color based on class
  const colorIndex = (classId >= 0 ? classId : index) % CLASS_COLORS.length
  const color = CLASS_COLORS[colorIndex]
  
  // Draw semi-transparent background
  ctx.fillStyle = color + '40'
  ctx.fillRect(x, y, width, height)

  // Draw border
  ctx.strokeStyle = color
  ctx.strokeRect(x, y, width, height)

  // Draw label
  const label = `${className} (${(confidence * 100).toFixed(1)}%)`
  const labelWidth = ctx.measureText(label).width
  
  // Label background
  ctx.fillStyle = color
  ctx.fillRect(x, y - 20, labelWidth + 8, 18)

  // Label text
  ctx.fillStyle = 'white'
  ctx.fillText(label, x + 4, y - 6)
}

// Create and export detector instance
export const detector = new ObjectDetector()
export { COCO_CLASSES, CLASS_COLORS }