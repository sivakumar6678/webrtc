#!/bin/bash

# Download SSD MobileNet v2 TensorFlow.js model for object detection

echo "🚀 Downloading SSD MobileNet v2 TensorFlow.js model..."

# Create models directory
mkdir -p frontend/public/models/ssd_mobilenet_v2

# Change to models directory
cd frontend/public/models/ssd_mobilenet_v2

# Download SSD MobileNet v2 TensorFlow.js model from TensorFlow.js models repository
echo "📥 Downloading SSD MobileNet v2 from TensorFlow.js models..."

# Model files to download from the official TensorFlow.js models repository
MODEL_BASE_URL="https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json"
WEIGHTS_URL="https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model_weights_1.bin"

if command -v wget &> /dev/null; then
    echo "Downloading model.json..."
    wget -O model.json "$MODEL_BASE_URL" || {
        echo "❌ Failed to download model.json with wget"
        exit 1
    }
    echo "Downloading model weights..."
    wget -O model_weights_1.bin "$WEIGHTS_URL" || {
        echo "❌ Failed to download model weights with wget"
        exit 1
    }
elif command -v curl &> /dev/null; then
    echo "Downloading model.json..."
    curl -L -o model.json "$MODEL_BASE_URL" || {
        echo "❌ Failed to download model.json with curl"
        exit 1
    }
    echo "Downloading model weights..."
    curl -L -o model_weights_1.bin "$WEIGHTS_URL" || {
        echo "❌ Failed to download model weights with curl"
        exit 1
    }
else
    echo "❌ Error: Neither wget nor curl found. Please install one of them."
    echo "   Or manually download:"
    echo "   1. $MODEL_BASE_URL -> model.json"
    echo "   2. $WEIGHTS_URL -> model_weights_1.bin"
    echo "   And place them in: frontend/public/models/ssd_mobilenet_v2/"
    exit 1
fi

# Check if downloads were successful
if [ -f "model.json" ] && [ -f "model_weights_1.bin" ]; then
    model_size=$(stat -f%z model.json 2>/dev/null || stat -c%s model.json 2>/dev/null)
    weights_size=$(stat -f%z model_weights_1.bin 2>/dev/null || stat -c%s model_weights_1.bin 2>/dev/null)
    
    if [ "$model_size" -gt 1000 ] && [ "$weights_size" -gt 1000000 ]; then  # Basic size check
        echo "✅ SSD MobileNet v2 model downloaded successfully!"
        echo "   Files:"
        echo "     - model.json ($(echo "scale=1; $model_size/1024" | bc 2>/dev/null || echo "$((model_size/1024))")KB)"
        echo "     - model_weights_1.bin ($(echo "scale=1; $weights_size/1024/1024" | bc 2>/dev/null || echo "$((weights_size/1024/1024))")MB)"
        echo ""
        echo "🎯 Ready for TensorFlow.js object detection!"
        echo "   The app will try to load from local path first, then fallback to CDN"
        echo "   Run: ./start.sh"
        echo "   Status should show: '✅ Local SSD MobileNet v2 loaded' or '✅ SSD MobileNet v2 (CDN) loaded'"
    else
        echo "❌ Download failed or files are too small"
        echo "   model.json: $((model_size/1024))KB"
        echo "   model_weights_1.bin: $((weights_size/1024/1024))MB"
        rm -f model.json model_weights_1.bin
        exit 1
    fi
else
    echo "❌ Download failed. Files not found."
    echo "   Please check your internet connection and try again."
    exit 1
fi

echo ""
echo "📖 Next steps:"
echo "   1. Run: ./start.sh"
echo "   2. Open desktop browser"
echo "   3. Connect phone camera"
echo "   4. Point at objects for real SSD MobileNet v2 detection!"
echo ""
echo "🔧 Model loading priority:"
echo "   1. Try local model: /models/ssd_mobilenet_v2/model.json"
echo "   2. Fallback to CDN: COCO-SSD from TensorFlow.js"