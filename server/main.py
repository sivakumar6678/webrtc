from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import uuid
from typing import Dict, Set
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Store active connections by room_id
rooms: Dict[str, Dict[str, WebSocket]] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        logger.info(f"Client {client_id} connected")

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            logger.info(f"Client {client_id} disconnected")

    async def send_personal_message(self, message: dict, client_id: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(json.dumps(message))

    async def broadcast_to_room(self, message: dict, room_id: str, exclude_client: str = None):
        if room_id in rooms:
            for client_id, websocket in rooms[room_id].items():
                if client_id != exclude_client:
                    try:
                        await websocket.send_text(json.dumps(message))
                    except:
                        # Remove disconnected client
                        del rooms[room_id][client_id]

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = None
    room_id = None
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "join":
                client_id = message["clientId"]
                room_id = message["roomId"]
                client_type = message["clientType"]  # "desktop" or "phone"
                
                # Initialize room if it doesn't exist
                if room_id not in rooms:
                    rooms[room_id] = {}
                
                # Add client to room
                rooms[room_id][client_id] = websocket
                
                logger.info(f"Client {client_id} ({client_type}) joined room {room_id}")
                
                # Notify other clients in the room
                await manager.broadcast_to_room({
                    "type": "user-joined",
                    "clientId": client_id,
                    "clientType": client_type
                }, room_id, exclude_client=client_id)
                
            elif message["type"] == "offer":
                # Forward offer to other clients in the room
                await manager.broadcast_to_room({
                    "type": "offer",
                    "offer": message["offer"],
                    "from": client_id
                }, room_id, exclude_client=client_id)
                
            elif message["type"] == "answer":
                # Forward answer to other clients in the room
                await manager.broadcast_to_room({
                    "type": "answer",
                    "answer": message["answer"],
                    "from": client_id
                }, room_id, exclude_client=client_id)
                
            elif message["type"] == "ice-candidate":
                # Forward ICE candidate to other clients in the room
                await manager.broadcast_to_room({
                    "type": "ice-candidate",
                    "candidate": message["candidate"],
                    "from": client_id
                }, room_id, exclude_client=client_id)
                
    except WebSocketDisconnect:
        logger.info(f"Client {client_id} disconnected from room {room_id}")
        if room_id and client_id and room_id in rooms:
            if client_id in rooms[room_id]:
                del rooms[room_id][client_id]
            
            # Notify other clients in the room
            await manager.broadcast_to_room({
                "type": "user-left",
                "clientId": client_id
            }, room_id)
            
            # Clean up empty rooms
            if not rooms[room_id]:
                del rooms[room_id]

# Serve static files from frontend/dist
app.mount("/static", StaticFiles(directory="../frontend/dist/assets"), name="static")

@app.get("/join/{room_id}")
async def join_page(room_id: str):
    return FileResponse("../frontend/dist/index.html")

@app.get("/")
async def read_root():
    return FileResponse("../frontend/dist/index.html")

@app.get("/{path:path}")
async def catch_all(path: str):
    return FileResponse("../frontend/dist/index.html")