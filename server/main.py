from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

# Phase 7.5: Imports for server-side inference
import asyncio
import base64
import io
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import onnxruntime as ort
from PIL import Image

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Phase 7.5: Globals for model and thread pool executor
# This will hold our loaded ONNX model session
ort_session = None
# A thread pool to run our blocking (CPU-intensive) model inference
executor = ThreadPoolExecutor(max_workers=2)
# COCO class names that YOLOv5 was trained on
COCO_CLASSES = [
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


# Phase 7.5: Function to load the model on startup
@app.on_event("startup")
async def startup_event():
    global ort_session
    model_path = "models/yolov5n.onnx"
    logger.info(f"Loading ONNX model from {model_path}...")
    try:
        # We use CPUExecutionProvider as required (no GPU needed)
        ort_session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
        logger.info("✅ ONNX model loaded successfully.")
    except Exception as e:
        logger.error(f"❌ Failed to load ONNX model: {e}")
        logger.info("Server will continue without inference capability")


# Phase 7.5: Helper functions for image processing and model inference
def preprocess_image(image: Image.Image, input_size: int = 640) -> tuple:
    """ Prepares the image for the YOLOv5 model. """
    # Resize and pad the image to be a square
    w, h = image.size
    scale = input_size / max(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Create a new square image and paste the resized image into it
    new_image = Image.new('RGB', (input_size, input_size), (114, 114, 114))
    new_image.paste(image, ((input_size - new_w) // 2, (input_size - new_h) // 2))

    # Convert to numpy array, scale to [0,1], and change layout to CHW (Channels, Height, Width)
    image_data = np.array(new_image, dtype=np.float32) / 255.0
    image_data = np.transpose(image_data, (2, 0, 1))  # HWC to CHW
    image_data = np.expand_dims(image_data, axis=0)   # Add batch dimension
    return image_data, scale, new_w, new_h


def postprocess_results(outputs: np.ndarray, scale: float, new_w: int, new_h: int, 
                       input_size: int = 640, conf_threshold: float = 0.5, 
                       iou_threshold: float = 0.45) -> list:
    """ Decodes the model output back into bounding boxes. """
    # This is a simplified NMS and decoding for YOLOv5.
    # The output format is [batch, num_predictions, 85] where 85 = [x, y, w, h, confidence, 80 class scores]
    predictions = outputs[0]
    
    # Filter out low-confidence predictions
    predictions = predictions[predictions[:, 4] > conf_threshold]

    if len(predictions) == 0:
        return []

    # Get class with highest score
    class_ids = np.argmax(predictions[:, 5:], axis=1)
    confidences = np.max(predictions[:, 5:], axis=1)

    # Convert box format from [center_x, center_y, width, height] to [x1, y1, x2, y2]
    box_coords = predictions[:, :4]
    pad_x = (input_size - new_w) // 2
    pad_y = (input_size - new_h) // 2
    
    x1 = (box_coords[:, 0] - box_coords[:, 2] / 2 - pad_x) / scale
    y1 = (box_coords[:, 1] - box_coords[:, 3] / 2 - pad_y) / scale
    x2 = (box_coords[:, 0] + box_coords[:, 2] / 2 - pad_x) / scale
    y2 = (box_coords[:, 1] + box_coords[:, 3] / 2 - pad_y) / scale
    
    boxes = np.column_stack([x1, y1, x2, y2])
    
    # Non-Maximum Suppression (a simplified version)
    indices = cv_nms(boxes, confidences, iou_threshold)
    
    detections = []
    for i in indices:
        x1, y1, x2, y2 = boxes[i]
        label = COCO_CLASSES[class_ids[i]]
        score = confidences[i]
        detections.append({
            "label": label, 
            "score": float(score), 
            "xmin": float(x1), 
            "ymin": float(y1), 
            "xmax": float(x2), 
            "ymax": float(y2)
        })
        
    return detections


def cv_nms(boxes, scores, thresh):
    """ A simple NMS implementation. """
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        inds = np.where(ovr <= thresh)[0]
        order = order[inds + 1]
    return keep


def run_inference(image_bytes: bytes, frame_id: str, capture_ts: float, recv_ts: float) -> dict:
    """ The main synchronous inference function with Phase 7.5 contract. """
    inference_start = time.time() * 1000  # Convert to milliseconds
    
    if ort_session is None:
        logger.warning("ONNX model is not loaded, skipping inference.")
        return {
            "frame_id": frame_id,
            "capture_ts": capture_ts,
            "recv_ts": recv_ts,
            "inference_ts": inference_start,
            "detections": []
        }
    
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        original_w, original_h = image.size
        
        # Preprocess
        input_data, scale, new_w, new_h = preprocess_image(image)
        
        # Run model
        input_name = ort_session.get_inputs()[0].name
        outputs = ort_session.run(None, {input_name: input_data})
        
        # Postprocess and get detections
        detections = postprocess_results(outputs[0], scale, new_w, new_h)
        
        # Normalize coordinates to [0,1] as required by Phase 7.5 spec
        for det in detections:
            det["xmin"] /= original_w
            det["ymin"] /= original_h
            det["xmax"] /= original_w
            det["ymax"] /= original_h

        inference_end = time.time() * 1000
        
        return {
            "frame_id": frame_id,
            "capture_ts": capture_ts,
            "recv_ts": recv_ts,
            "inference_ts": inference_end,
            "detections": detections
        }
    except Exception as e:
        logger.error(f"Error during inference: {e}")
        return {
            "frame_id": frame_id,
            "capture_ts": capture_ts,
            "recv_ts": recv_ts,
            "inference_ts": time.time() * 1000,
            "detections": []
        }


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
            
            # Phase 7.5: Handler for server-side inference
            elif msg_type == "frame-for-inference":
                if role != "desktop" or not room_id:
                    continue  # Only desktop can request inference
                
                # Get the current asyncio loop for thread pool execution
                loop = asyncio.get_running_loop()
                
                # Image data is expected to be a base64-encoded string
                image_data_b64 = msg.get("imageData")
                frame_id = msg.get("frame_id", "unknown")
                capture_ts = msg.get("capture_ts", time.time() * 1000)
                
                if not image_data_b64:
                    continue
                
                recv_ts = time.time() * 1000  # Mark when server received the frame
                
                try:
                    # The data URL prefix needs to be removed (e.g., "data:image/jpeg;base64,")
                    if "," in image_data_b64:
                        header, encoded = image_data_b64.split(",", 1)
                    else:
                        encoded = image_data_b64
                    
                    image_bytes = base64.b64decode(encoded)
                    
                    # Run the blocking inference function in the thread pool to avoid freezing the server
                    result = await loop.run_in_executor(
                        executor, 
                        run_inference, 
                        image_bytes, 
                        frame_id, 
                        capture_ts, 
                        recv_ts
                    )
                    
                    # Send the results back to the desktop client
                    response_payload = {
                        "type": "inference-result",
                        "roomId": room_id,
                        **result  # Includes frame_id, capture_ts, recv_ts, inference_ts, detections
                    }
                    await ws.send_text(json.dumps(response_payload))
                    
                    logger.debug(f"Inference completed for frame {frame_id}: {len(result['detections'])} detections")
                    
                except Exception as e:
                    logger.error(f"Error processing frame-for-inference: {e}")
                    # Send error response
                    error_response = {
                        "type": "inference-result",
                        "roomId": room_id,
                        "frame_id": frame_id,
                        "capture_ts": capture_ts,
                        "recv_ts": recv_ts,
                        "inference_ts": time.time() * 1000,
                        "detections": [],
                        "error": str(e)
                    }
                    await ws.send_text(json.dumps(error_response))

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

# HUD-enabled version for testing Phase 5
@app.get("/hud")
async def hud_version():
    return FileResponse(DIST_DIR / "hud-integration.html")

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