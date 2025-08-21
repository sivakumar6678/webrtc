#!/bin/bash

# WebRTC Multi-Object Detection Startup Script

MODE=${1:-wasm}

echo "Starting WebRTC Multi-Object Detection in $MODE mode..."

# Export MODE for server to use
export MODE=$MODE

# Kill any process already on port 8000
echo "Checking for existing server on port 8000..."
lsof -ti:8000 | xargs kill -9 2>/dev/null

# Start the FastAPI server
cd server
if [ -d "venv" ]; then
  source venv/bin/activate
else
  echo "⚠️  No virtualenv found in server/venv. Using system python."
fi

echo "Starting FastAPI server on port 8000..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
SERVER_PID=$!

echo "Server started with PID: $SERVER_PID"
echo ""
echo "=== Setup Instructions ==="
echo "1. In another terminal, run: ngrok http 8000"
echo "2. Copy the HTTPS URL from ngrok (e.g., https://abc123.ngrok.io)"
echo "3. Open that URL in your desktop browser"
echo "4. Scan the QR code with your phone"
echo "5. Grant camera permission on phone"
echo "6. Video stream should appear on desktop"
echo ""
echo "Press Ctrl+C to stop the server"

# Wait for interrupt
trap "echo 'Stopping server...'; kill $SERVER_PID; exit" INT
wait $SERVER_PID
