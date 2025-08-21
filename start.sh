#!/bin/bash

# WebRTC Multi-Object Detection Startup Script
# Usage: ./start.sh [--mode wasm|server] [--ngrok]

set -e

# Default values
MODE="wasm"
USE_NGROK=false
USE_DOCKER=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --ngrok)
      USE_NGROK=true
      shift
      ;;
    --no-docker)
      USE_DOCKER=false
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--mode wasm|server] [--ngrok] [--no-docker]"
      echo ""
      echo "Options:"
      echo "  --mode wasm|server  Detection mode (default: wasm)"
      echo "  --ngrok            Start ngrok tunnel automatically"
      echo "  --no-docker        Use local development mode instead of Docker"
      echo "  -h, --help         Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0                    # Start in WASM mode with Docker"
      echo "  $0 --mode server      # Start in Server mode with Docker"
      echo "  $0 --mode wasm --ngrok # Start with automatic ngrok tunnel"
      echo "  $0 --no-docker        # Start in local development mode"
      exit 0
      ;;
    *)
      # Support legacy positional argument
      if [[ "$1" == "wasm" || "$1" == "server" ]]; then
        MODE="$1"
        shift
      else
        echo "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
      fi
      ;;
  esac
done

# Validate mode
if [[ "$MODE" != "wasm" && "$MODE" != "server" ]]; then
  echo "❌ Invalid mode: $MODE. Must be 'wasm' or 'server'"
  exit 1
fi

echo "🚀 Starting WebRTC Multi-Object Detection"
echo "   Mode: $MODE"
echo "   Docker: $([ "$USE_DOCKER" = true ] && echo "enabled" || echo "disabled")"
echo "   Ngrok: $([ "$USE_NGROK" = true ] && echo "enabled" || echo "disabled")"
echo ""

# Export MODE for all processes
export MODE=$MODE

# Function to check if Docker is available
check_docker() {
  if command -v docker >/dev/null 2>&1 && command -v docker-compose >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

# Function to generate QR code in terminal
generate_qr() {
  local url="$1"
  if command -v qrencode >/dev/null 2>&1; then
    echo "📱 QR Code for phone connection:"
    qrencode -t ANSIUTF8 "$url"
  else
    echo "📱 Phone URL: $url"
    echo "   (Install 'qrencode' for terminal QR code display)"
  fi
}

# Function to start ngrok
start_ngrok() {
  local port="$1"
  if command -v ngrok >/dev/null 2>&1; then
    echo "🌐 Starting ngrok tunnel on port $port..."
    ngrok http $port --log=stdout > /tmp/ngrok.log 2>&1 &
    NGROK_PID=$!
    
    # Wait for ngrok to start and extract URL
    sleep 3
    local ngrok_url=$(curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*\.ngrok\.io' | head -1)
    
    if [[ -n "$ngrok_url" ]]; then
      echo "✅ Ngrok tunnel active: $ngrok_url"
      generate_qr "$ngrok_url"
      echo ""
      return 0
    else
      echo "⚠️  Failed to get ngrok URL. Check /tmp/ngrok.log"
      return 1
    fi
  else
    echo "⚠️  ngrok not found. Install from https://ngrok.com/download"
    return 1
  fi
}

# Function to cleanup processes
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  
  if [[ -n "$NGROK_PID" ]]; then
    kill $NGROK_PID 2>/dev/null || true
  fi
  
  if [[ "$USE_DOCKER" = true ]]; then
    echo "   Stopping Docker containers..."
    docker-compose down 2>/dev/null || true
  else
    if [[ -n "$SERVER_PID" ]]; then
      kill $SERVER_PID 2>/dev/null || true
    fi
    # Kill any remaining processes on ports
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  fi
  
  echo "✅ Cleanup complete"
  exit 0
}

# Set up signal handlers
trap cleanup INT TERM

# Main execution
if [[ "$USE_DOCKER" = true ]] && check_docker; then
  echo "🐳 Using Docker mode"
  
  # Clean up any existing containers
  docker-compose down 2>/dev/null || true
  
  # Start services
  echo "   Building and starting containers..."
  docker-compose up --build -d
  
  # Wait for services to be ready
  echo "   Waiting for services to start..."
  sleep 5
  
  # Check if services are running
  if docker-compose ps | grep -q "Up"; then
    echo "✅ Services started successfully"
    
    # Determine the port based on setup
    local app_port=5173
    local app_url="http://localhost:$app_port"
    
    echo ""
    echo "🌐 Application URLs:"
    echo "   Local: $app_url"
    
    # Start ngrok if requested
    if [[ "$USE_NGROK" = true ]]; then
      start_ngrok $app_port
    else
      echo ""
      echo "📱 To connect your phone:"
      echo "   1. Run: ngrok http $app_port"
      echo "   2. Use the HTTPS URL from ngrok"
      generate_qr "$app_url"
    fi
    
    echo ""
    echo "📊 Container status:"
    docker-compose ps
    
    echo ""
    echo "🔍 To view logs: docker-compose logs -f"
    echo "🛑 To stop: docker-compose down"
    echo ""
    echo "Press Ctrl+C to stop all services"
    
    # Wait for interrupt
    while true; do
      sleep 1
    done
    
  else
    echo "❌ Failed to start services"
    docker-compose logs
    exit 1
  fi
  
else
  echo "🔧 Using local development mode"
  
  if [[ "$USE_DOCKER" = true ]]; then
    echo "   (Docker not available, falling back to local mode)"
  fi
  
  # Kill any existing processes
  echo "   Cleaning up existing processes..."
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  
  # Start the FastAPI server
  cd server
  if [ -d "venv" ]; then
    source venv/bin/activate
    echo "   Using virtual environment: server/venv"
  else
    echo "   ⚠️  No virtualenv found in server/venv. Using system python."
  fi
  
  echo "   Starting FastAPI server on port 8000..."
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
  SERVER_PID=$!
  
  cd ..
  
  # The frontend is served by the FastAPI server in local mode
  local app_port=8000
  local app_url="http://localhost:$app_port"
  
  echo "✅ Server started with PID: $SERVER_PID"
  echo ""
  echo "🌐 Application URLs:"
  echo "   Local: $app_url"
  
  # Start ngrok if requested
  if [[ "$USE_NGROK" = true ]]; then
    start_ngrok $app_port
  else
    echo ""
    echo "📱 To connect your phone:"
    echo "   1. Run: ngrok http $app_port"
    echo "   2. Use the HTTPS URL from ngrok"
    generate_qr "$app_url"
  fi
  
  echo ""
  echo "🔍 Server logs will appear below..."
  echo "🛑 Press Ctrl+C to stop the server"
  echo ""
  
  # Wait for interrupt
  wait $SERVER_PID
fi
