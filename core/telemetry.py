"""
Cockpit OS — Service & Router de Télémétrie SimHub
Gère l'ingestion HTTP POST, le stockage du dernier état en mémoire et la diffusion
WebSocket en direct via /ws/telemetry.
"""

from typing import Optional, Any, Dict, Set, List
from pydantic import BaseModel
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["telemetry"])


# ── Modèles Pydantic pour la Télémétrie SimHub ──────────────────────────────

class ElectronicsData(BaseModel):
    tc: Optional[int] = None
    tcActive: Optional[bool] = None
    abs: Optional[int] = None
    absActive: Optional[bool] = None
    brakeBias: Optional[float] = None
    engineMap: Optional[int] = None
    tcSlip: Optional[float] = None
    tcCut: Optional[float] = None
    frontAntiSway: Optional[float] = None
    rearAntiSway: Optional[float] = None
    brakeMigration: Optional[float] = None
    regenSetting: Optional[float] = None
    electricBoostPowerKw: Optional[float] = None
    electricBoostState: Optional[int] = None
    deploySetting: Optional[float] = None


class FuelData(BaseModel):
    liters: Optional[float] = None
    maxCapacity: Optional[float] = None
    percent: Optional[float] = None
    estimatedLaps: Optional[float] = None
    ersPercent: Optional[float] = None
    avgConsumptionPerLap: Optional[float] = None
    lastLapConsumption: Optional[float] = None
    refuelLiters: Optional[float] = None


class TireDetail(BaseModel):
    temp: Optional[float] = None
    carcassTemp: Optional[float] = None
    innerTemp: Optional[float] = None
    psi: Optional[float] = None
    wear: Optional[float] = None
    compound: Optional[str] = None


class TiresData(BaseModel):
    fl: Optional[TireDetail] = None
    fr: Optional[TireDetail] = None
    rl: Optional[TireDetail] = None
    rr: Optional[TireDetail] = None


class BrakesData(BaseModel):
    fl: Optional[float] = None
    fr: Optional[float] = None
    rl: Optional[float] = None
    rr: Optional[float] = None


class SessionData(BaseModel):
    type: Optional[str] = None
    timeLeftSeconds: Optional[float] = None
    lap: Optional[int] = None
    totalLaps: Optional[int] = None
    position: Optional[int] = None
    totalOpponents: Optional[int] = None
    deltaToSessionBest: Optional[float] = None
    lastLapTimeSeconds: Optional[float] = None
    bestLapTimeSeconds: Optional[float] = None
    currentSectorIndex: Optional[int] = None
    sector1Seconds: Optional[float] = None
    sector2Seconds: Optional[float] = None
    sector3Seconds: Optional[float] = None
    sector1BestSeconds: Optional[float] = None
    sector2BestSeconds: Optional[float] = None
    sector3BestSeconds: Optional[float] = None
    sector1SessionBestSeconds: Optional[float] = None
    sector2SessionBestSeconds: Optional[float] = None
    sector3SessionBestSeconds: Optional[float] = None
    airTemp: Optional[float] = None
    trackTemp: Optional[float] = None
    timeOfDay: Optional[str] = None


class OpponentData(BaseModel):
    name: Optional[str] = None
    gap: Optional[float] = None


class StandingEntry(BaseModel):
    position: Optional[int] = None
    name: Optional[str] = None
    gap: Optional[float] = None
    isPlayer: Optional[bool] = None
    lastLapTime: Optional[float] = None
    bestLapTime: Optional[float] = None
    vehicleClass: Optional[str] = None
    vehicleNumber: Optional[str] = None
    teamName: Optional[str] = None
    tireCompound: Optional[str] = None
    lapsCompleted: Optional[int] = None
    inPits: Optional[bool] = None


class TelemetryIngestModel(BaseModel):
    timestamp: Any  # Champ obligatoire
    game: Optional[str] = None
    standings: Optional[List[StandingEntry]] = None
    speedKmh: Optional[float] = None
    gear: Optional[str] = None
    rpm: Optional[float] = None
    maxRpm: Optional[float] = None
    rpmShiftLight1: Optional[float] = None
    rpmShiftLight2: Optional[float] = None
    throttle: Optional[float] = None
    brake: Optional[float] = None
    clutch: Optional[float] = None
    electronics: Optional[ElectronicsData] = None
    pitLimiterOn: Optional[bool] = None
    isInPit: Optional[bool] = None
    drsAvailable: Optional[bool] = None
    drsEnabled: Optional[bool] = None
    headlightsOn: Optional[bool] = None
    wipersMode: Optional[int] = None
    engineRunning: Optional[bool] = None
    hypercarBatteryPercent: Optional[float] = None
    fuel: Optional[FuelData] = None
    tires: Optional[TiresData] = None
    brakes: Optional[BrakesData] = None
    session: Optional[SessionData] = None
    opponentAhead: Optional[OpponentData] = None
    opponentBehind: Optional[OpponentData] = None


# ── Gestionnaire de Télémetrie en Mémoire & Broadcast WebSocket ──────────────

class TelemetryManager:
    def __init__(self):
        self.latest_telemetry: Optional[Dict[str, Any]] = None
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"Client WebSocket Télémétrie connecté. Clients actifs : {len(self.active_connections)}")
        
        # Envoyer immédiatement le dernier état s'il existe
        if self.latest_telemetry is not None:
            try:
                await websocket.send_json(self.latest_telemetry)
            except Exception as e:
                logger.warning(f"Erreur envoi état initial télémétrie : {e}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"Client WebSocket Télémétrie déconnecté. Clients actifs : {len(self.active_connections)}")

    async def update_and_broadcast(self, data: Dict[str, Any]):
        self.latest_telemetry = data
        if not self.active_connections:
            return

        dead_connections = set()
        for websocket in list(self.active_connections):
            try:
                await websocket.send_json(data)
            except Exception as e:
                dead_connections.add(websocket)

        for ws in dead_connections:
            self.disconnect(ws)


telemetry_manager = TelemetryManager()


# ── Endpoints HTTP & WebSocket ─────────────────────────────────────────────────

@router.post("/telemetry/ingest")
async def ingest_telemetry(payload: TelemetryIngestModel):
    """
    1. Reçoit le JSON de télémétrie (~12Hz / 80ms)
    2. Stocke le dernier état en mémoire
    3. Broadcast à tous les clients WebSocket connectés
    """
    data_dict = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    await telemetry_manager.update_and_broadcast(data_dict)
    return {"status": "ok"}


@router.get("/telemetry/latest")
async def get_latest_telemetry():
    """Retourne le dernier état de télémétrie stocké en mémoire."""
    return telemetry_manager.latest_telemetry or {}


@router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """
    Point d'entrée WebSocket pour la diffusion en temps réel de la télémétrie.
    """
    await telemetry_manager.connect(websocket)
    try:
        while True:
            # Maintient la connexion ouverte et gère la fermeture propre
            await websocket.receive_text()
    except WebSocketDisconnect:
        telemetry_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"Fermeture WebSocket télémétrie : {e}")
        telemetry_manager.disconnect(websocket)
