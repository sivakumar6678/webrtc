#!/usr/bin/env python3
"""
Simple test script to verify server mode functionality
Tests the ONNX model loading and inference pipeline
"""

import sys
import os
import base64
import io
from PIL import Image
import numpy as np

# Add server directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'server'))

try:
    # Change to server directory for model path
    os.chdir(os.path.join(os.path.dirname(__file__), 'server'))
    from main import run_inference, ort_session, startup_event
    import asyncio
    
    async def test_server_mode():
        print("🧪 Testing Server Mode Functionality")
        print("=" * 50)
        
        # Initialize the model
        print("1. Loading ONNX model...")
        await startup_event()
        
        # Import ort_session after startup
        from main import ort_session
        
        if ort_session is None:
            print("❌ Failed to load ONNX model")
            return False
            
        print("✅ ONNX model loaded successfully")
        
        # Create a test image (640x480 RGB)
        print("2. Creating test image...")
        test_image = Image.new('RGB', (640, 480), color=(128, 128, 128))
        
        # Add some simple shapes to detect
        from PIL import ImageDraw
        draw = ImageDraw.Draw(test_image)
        draw.rectangle([100, 100, 200, 200], fill=(255, 0, 0))  # Red rectangle
        draw.ellipse([300, 200, 400, 300], fill=(0, 255, 0))    # Green circle
        
        # Convert to bytes
        img_buffer = io.BytesIO()
        test_image.save(img_buffer, format='JPEG')
        image_bytes = img_buffer.getvalue()
        
        print(f"✅ Test image created ({len(image_bytes)} bytes)")
        
        # Run inference
        print("3. Running inference...")
        detections = run_inference(image_bytes)
        
        print(f"✅ Inference completed: {len(detections)} detections")
        
        # Display results
        if detections:
            print("4. Detection results:")
            for i, det in enumerate(detections):
                print(f"   {i+1}. {det['label']} ({det['score']:.3f}) at [{det['xmin']:.3f}, {det['ymin']:.3f}, {det['xmax']:.3f}, {det['ymax']:.3f}]")
        else:
            print("4. No objects detected (this is normal for a simple test image)")
            
        print("\n🎉 Server mode test completed successfully!")
        return True
        
    if __name__ == "__main__":
        success = asyncio.run(test_server_mode())
        sys.exit(0 if success else 1)
        
except ImportError as e:
    print(f"❌ Import error: {e}")
    print("Make sure you're running this from the project root directory")
    sys.exit(1)
except Exception as e:
    print(f"❌ Test failed: {e}")
    sys.exit(1)