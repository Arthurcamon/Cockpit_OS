"""
Cockpit OS — Endpoints Setup (actions réelles sur les applications du PC)

Même pattern que core/shortcuts.py::system_action (asyncio.to_thread autour
d'un appel bloquant) : la fermeture n'est déclenchée ici QUE par le backend,
jamais depuis le frontend seul — la confirmation (modale plein écran,
web/tabs/setup.html) a lieu côté tablette AVANT cet appel, jamais après.
"""

import asyncio
import platform

from fastapi import APIRouter, Depends, HTTPException

from core.logger import get_logger
from core.shortcuts import verify_token

logger = get_logger(__name__)

router = APIRouter(prefix="/setup", tags=["Setup"], dependencies=[Depends(verify_token)])


def _close_process_sync(pid: int) -> None:
    import psutil

    proc = psutil.Process(pid)
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except psutil.TimeoutExpired:
        proc.kill()


@router.post("/apps/close/{pid}")
async def close_app(pid: int):
    """Ferme réellement l'application (PID donné) sur le PC."""
    if platform.system() != "Windows":
        raise HTTPException(status_code=501, detail="Fermeture de processus non supportée hors Windows")

    import psutil

    logger.info(f"[Setup] Fermeture d'application demandée : PID {pid}")

    try:
        await asyncio.to_thread(_close_process_sync, pid)
    except psutil.NoSuchProcess:
        raise HTTPException(status_code=404, detail=f"Processus {pid} introuvable (déjà fermé ?)")
    except psutil.AccessDenied:
        raise HTTPException(status_code=403, detail=f"Accès refusé pour fermer le processus {pid}")
    except Exception as e:
        logger.error(f"[Setup] Échec fermeture processus {pid} : {e}")
        raise HTTPException(status_code=500, detail=f"Échec de la fermeture : {e}")

    return {"status": "ok", "pid": pid, "message": "Application fermée"}
