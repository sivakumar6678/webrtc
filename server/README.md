# FastAPI WebRTC Signaling + Static Frontend

## Overview
This server provides a minimal WebSocket signaling service for Phone → Desktop WebRTC streaming and serves the built React (Vite) frontend.

- WebSocket endpoint: `/ws`
- Static files: served from `../frontend/dist` at root `/`
- Roles: `phone` (offerer), `desktop` (answerer)

## Run locally
1) Install Python deps:
```
python3 -m venv venv
source venv/bin/activate
pip install -r server/requirements.txt
```

2) Build the frontend:
```
cd frontend
npm install
npm run build
cd ..
```

3) Start the backend:
```
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

4) Use HTTPS via ngrok for camera permissions on mobile:
```
ngrok http 8000
```
Open the ngrok https URL on desktop. Scan the QR with the phone.

## Flow
- Desktop opens `/` → generates roomId, shows QR → joins WS as `desktop`.
- Phone opens `/join/:roomId` → gets camera → joins WS as `phone` → creates and sends offer.
- Desktop receives offer → creates and sends answer.
- Both sides exchange ICE candidates through the server.

## Notes
- STUN: `stun:stun.l.google.com:19302`
- Minimal message schema:
  - join: `{ type, role, roomId }`
  - offer/answer: `{ type, roomId, sdp }`
  - ice: `{ type: 'ice-candidate', roomId, candidate }`