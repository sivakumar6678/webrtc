from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# In-memory signaling store
# rooms: {
#   "<roomId>": {
#       "offer": Optional[str],                 # SDP string from phone (offerer)
#       "offerCandidates": list[dict],          # ICE candidates from phone
#       "answer": Optional[str],                # SDP string from desktop (answerer)
#       "answerCandidates": list[dict],         # ICE candidates from desktop
#       "desktopConnected": bool,
#       "phoneConnected": bool
#   }
# }
rooms: Dict[str, Dict[str, Any]] = {}

# Store live websocket connections per room/role (not persisted)
# connections: { roomId: { "phone": WebSocket | None, "desktop": WebSocket | None } }
connections: Dict[str, Dict[str, Optional[WebSocket]]] = {}


def get_room(room_id: str) -> Dict[str, Any]:
    if room_id not in rooms:
        rooms[room_id] = {
            "offer": None,
            "offerCandidates": [],
            "answer": None,
            "answerCandidates": [],
            "desktopConnected": False,
            "phoneConnected": False,
            "cameraType": None,
        }
    if room_id not in connections:
        connections[room_id] = {"phone": None, "desktop": None}
    return rooms[room_id]


async def relay_or_queue(room_id: str, from_role: str, payload: dict) -> None:
    """Relay payload to the opposite role if connected; else queue if candidate.
    For offer/answer we store the SDP on the room; for candidates we append to the respective list.
    """
    opp_role = "desktop" if from_role == "phone" else "phone"
    opp_ws = connections.get(room_id, {}).get(opp_role)

    msg_type = payload.get("type")

    # Persist state
    room = get_room(room_id)
    if msg_type == "offer":
        room["offer"] = payload.get("sdp")
    elif msg_type == "answer":
        room["answer"] = payload.get("sdp")
    elif msg_type == "ice-candidate":
        candidate = payload.get("candidate")
        if from_role == "phone":
            room["offerCandidates"].append(candidate)
        else:
            room["answerCandidates"].append(candidate)

    # Relay if possible
    if opp_ws is not None:
        try:
            await opp_ws.send_text(json.dumps(payload))
        except Exception as e:
            logger.warning(f"Failed to relay to {opp_role} in room {room_id}: {e}")


async def send_backlog(room_id: str, role: str) -> None:
    """Upon join, deliver any backlog to the joining role."""
    room = get_room(room_id)
    ws = connections[room_id][role]
    if ws is None:
        return

    try:
        if role == "desktop":
            # Send offer from phone if available
            if room["offer"]:
                await ws.send_text(json.dumps({
                    "type": "offer",
                    "roomId": room_id,
                    "sdp": room["offer"],
                }))
            # Send any offer-side ICE candidates
            for cand in room["offerCandidates"]:
                await ws.send_text(json.dumps({
                    "type": "ice-candidate",
                    "roomId": room_id,
                    "candidate": cand,
                }))
        elif role == "phone":
            # Send answer from desktop if available
            if room["answer"]:
                await ws.send_text(json.dumps({
                    "type": "answer",
                    "roomId": room_id,
                    "sdp": room["answer"],
                }))
            # Send any answer-side ICE candidates
            for cand in room["answerCandidates"]:
                await ws.send_text(json.dumps({
                    "type": "ice-candidate",
                    "roomId": room_id,
                    "candidate": cand,
                }))
    except Exception as e:
        logger.warning(f"Failed sending backlog to {role} in room {room_id}: {e}")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    room_id: Optional[str] = None
    role: Optional[str] = None  # "phone" or "desktop"

    try:
        while True:
            message_raw = await ws.receive_text()
            msg = json.loads(message_raw)
            msg_type = msg.get("type")
            room_id = msg.get("roomId")

            if msg_type == "join":
                role = msg.get("role")  # expected: "phone" or "desktop"
                if role not in ("phone", "desktop") or not room_id:
                    await ws.close()
                    return

                room = get_room(room_id)
                connections[room_id][role] = ws
                if role == "phone":
                    room["phoneConnected"] = True
                    # Store camera type if provided
                    camera_type = msg.get("cameraType")
                    if camera_type:
                        room["cameraType"] = camera_type
                        # Relay camera type to desktop if connected
                        desktop_ws = connections[room_id].get("desktop")
                        if desktop_ws:
                            try:
                                await desktop_ws.send_text(json.dumps({
                                    "type": "join",
                                    "role": "phone",
                                    "roomId": room_id,
                                    "cameraType": camera_type
                                }))
                            except Exception as e:
                                logger.warning(f"Failed to relay camera type to desktop: {e}")
                else:
                    room["desktopConnected"] = True
                    # Send camera type to desktop if phone already connected
                    if "cameraType" in room:
                        try:
                            await ws.send_text(json.dumps({
                                "type": "join",
                                "role": "phone",
                                "roomId": room_id,
                                "cameraType": room["cameraType"]
                            }))
                        except Exception as e:
                            logger.warning(f"Failed to send camera type to desktop: {e}")

                logger.info(f"{role} joined room {room_id}")

                # On join, push any backlog relevant to this role
                await send_backlog(room_id, role)

            elif msg_type in ("offer", "answer", "ice-candidate"):
                if not room_id or not role:
                    continue
                # Normalize payload to minimal schema
                payload: Dict[str, Any] = {
                    "type": msg_type,
                    "roomId": room_id,
                }
                if msg_type in ("offer", "answer"):
                    payload["sdp"] = msg.get("sdp")
                elif msg_type == "ice-candidate":
                    payload["candidate"] = msg.get("candidate")

                await relay_or_queue(room_id, role, payload)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WebSocket error: {e}")
    finally:
        # Cleanup on disconnect
        if room_id and role:
            if room_id in connections and connections[room_id].get(role) is ws:
                connections[room_id][role] = None
            room = rooms.get(room_id)
            if room:
                if role == "phone":
                    room["phoneConnected"] = False
                else:
                    room["desktopConnected"] = False
                # Optionally cleanup room if both disconnected
                if not room["phoneConnected"] and not room["desktopConnected"]:
                    # Keep SDP/candidates around briefly could be considered; for now purge
                    rooms.pop(room_id, None)
                    connections.pop(room_id, None)


# Serve static frontend (Vite build) with SPA fallbacks (avoid mounting at "/" to prevent 404 on deep links)
from pathlib import Path
DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
ASSETS_DIR = DIST_DIR / "assets"

# Serve built assets
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

# Root and SPA routes serve index.html
@app.get("/")
async def index():
    return FileResponse(DIST_DIR / "index.html")

@app.get("/join/{room_id}")
async def spa_join(room_id: str):
    return FileResponse(DIST_DIR / "index.html")

@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    return FileResponse(DIST_DIR / "index.html")

# Serve Vite icon (avoids 404 in console)
@app.get("/vite.svg")
async def vite_icon():
    file_path = DIST_DIR / "vite.svg"
    return FileResponse(file_path) if file_path.exists() else FileResponse(DIST_DIR / "index.html")