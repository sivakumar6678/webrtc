#!/bin/bash

# Download YOLOv8n ONNX model for Phase 4.1 Real Object Detection

echo "🚀 Downloading YOLOv8n ONNX model for real object detection..."

# Create models directory
mkdir -p frontend/public/models

# Change to models directory
cd frontend/public/models

# Download YOLOv8n ONNX model (6.2MB)
echo "📥 Downloading yolov8n.onnx from Ultralytics..."

if command -v wget &> /dev/null; then
    wget -O yolov8n.onnx https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
elif command -v curl &> /dev/null; then
    curl -L -o yolov8n.onnx https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
else
    echo "❌ Error: Neither wget nor curl found. Please install one of them."
    echo "   Or manually download: https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx"
    echo "   And place it in: frontend/public/models/yolov8n.onnx"
    exit 1
fi

# Check if download was successful
if [ -f "yolov8n.onnx" ]; then
    file_size=$(stat -f%z yolov8n.onnx 2>/dev/null || stat -c%s yolov8n.onnx 2>/dev/null)
    if [ "$file_size" -gt 5000000 ]; then  # Should be ~6.2MB
        echo "✅ YOLOv8n model downloaded successfully!"
        echo "   File: frontend/public/models/yolov8n.onnx"
        echo "   Size: $(echo "scale=1; $file_size/1024/1024" | bc 2>/dev/null || echo "$((file_size/1024/1024))")MB"
        echo ""
        echo "🎯 Ready for Phase 4.1 real object detection!"
        echo "   Run: ./start.sh"
        echo "   Status should show: '✅ YOLOv8n model loaded'"
    else
        echo "❌ Download failed or file is too small"
        echo "   Expected size: ~6.2MB, Got: $((file_size/1024/1024))MB"
        rm -f yolov8n.onnx
        exit 1
    fi
else
    echo "❌ Download failed. File not found."
    echo "   Please check your internet connection and try again."
    exit 1
fi

echo ""
echo "📖 Next steps:"
echo "   1. Run: ./start.sh"
echo "   2. Open desktop browser to ngrok URL"
echo "   3. Connect phone camera"
echo "   4. Point at objects for real YOLOv8 detection!"