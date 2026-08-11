"""
Cockpit OS — Serveur web FastAPI
Responsable de :
  - Servir les fichiers frontend statiques
  - Enregistrer les routes API REST
  - Démarrer le point d'entrée WebSocket
"""

import asyncio
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from core.logger import get_logger
from core.websocket import handle_websocket, ws_manager
from core.shortcuts import router as shortcuts_router
from core.telemetry import router as telemetry_router
from config import settings

logger = get_logger(__name__)

# Chemin vers le dossier frontend
WEB_DIR = Path(__file__).parent.parent / "web"

# Version unique générée à chaque démarrage du serveur.
# Injectée dans les URLs du frontend pour forcer les navigateurs/webviews
# (y compris ceux qui ignorent Cache-Control) à recharger les fichiers.
APP_VERSION = str(int(time.time()))


def create_app() -> FastAPI:
    """
    Crée et configure l'application FastAPI.
    Enregistre toutes les routes et middlewares.
    """
    app = FastAPI(
        title="Cockpit OS",
        description="Interface tactile locale multimédia",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url=None,
    )

    # Middleware CORS (utile en développement)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Middleware anti-cache : force le rechargement des fichiers statiques.
    # Indispensable pour les tablettes/webviews qui ignorent souvent le cache-busting
    # côté client (pas de Ctrl+Maj+R sur tactile).
    @app.middleware("http")
    async def no_cache_middleware(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(("/css", "/js", "/tabs", "/")):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        return response

    # Enregistrer les routers API
    app.include_router(shortcuts_router)
    app.include_router(telemetry_router)

    # ── Routes API REST ────────────────────────────────────────────────────────

    @app.get("/api/health")
    async def health_check():
        """Vérifie que le serveur est opérationnel."""
        return {
            "status": "ok",
            "app": "Cockpit OS",
            "ws_clients": ws_manager.client_count,
        }

    @app.get("/api/status")
    async def get_status():
        """Retourne l'état complet du système."""
        from services.windows_media import windows_media_service
        from services.windows_audio import windows_audio_service

        media_state = await windows_media_service.get_current_state()
        audio_state = await windows_audio_service.get_full_state()

        return {
            "media": media_state,
            "audio": audio_state,
            "ws_clients": ws_manager.client_count,
        }

    @app.get("/api/debug/media")
    async def debug_media():
        """
        Diagnostic complet de Windows Media Session.
        Ouvrir dans le navigateur : http://localhost:8000/api/debug/media
        Montre toutes les sessions actives, leurs sources, titres, et erreurs éventuelles.
        """
        from services.windows_media import windows_media_service
        return await windows_media_service.get_diagnostic()

    @app.get("/api/debug/audio")
    async def debug_audio():
        """
        Diagnostic complet de l'audio Windows (pycaw).
        Ouvrir dans le navigateur : http://localhost:8000/api/debug/audio
        """
        from services.windows_audio import windows_audio_service
        state = await windows_audio_service.get_full_state()
        return state

    @app.get("/api/debug/deezer-player")
    async def debug_deezer_player():
        """
        Diagnostic CDP Deezer Player.
        Vérifie si Deezer Desktop est accessible via le port 9222.
        Ouvrir dans le navigateur : http://localhost:8000/api/debug/deezer-player
        """
        from services.deezer_player import deezer_player_service
        return await deezer_player_service.get_diagnostic()

    # ── WebSocket ──────────────────────────────────────────────────────────────

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        """Point d'entrée unique pour toutes les connexions WebSocket."""
        await handle_websocket(websocket)

    # ── Fichiers statiques frontend ────────────────────────────────────────────

    # Servir le dossier CSS, JS, assets
    if WEB_DIR.exists():
        app.mount("/css", StaticFiles(directory=str(WEB_DIR / "css")), name="css")
        app.mount("/js", StaticFiles(directory=str(WEB_DIR / "js")), name="js")
        app.mount("/tabs", StaticFiles(directory=str(WEB_DIR / "tabs")), name="tabs")

    assets_dir = Path(__file__).parent.parent / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    async def serve_index():
        """
        Sert la page principale de l'interface, en injectant APP_VERSION
        pour forcer le rechargement du CSS/JS/fragments HTML à chaque
        redémarrage du serveur (contourne les caches tablette récalcitrants).
        """
        index_path = WEB_DIR / "index.html"
        if not index_path.exists():
            return JSONResponse({"error": "Frontend non trouvé"}, status_code=404)

        html = index_path.read_text(encoding="utf-8")
        html = html.replace("__APP_VERSION__", APP_VERSION)
        return HTMLResponse(
            content=html,
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
            },
        )

    # ── Tâches de fond : polling média & audio Windows ─────────────────────────

    @app.on_event("startup")
    async def start_background_polling():
        """Démarre le polling périodique de l'état média et de l'état audio Windows."""
        asyncio.create_task(_media_polling_task())
        asyncio.create_task(_audio_polling_task())
        logger.info("Cockpit OS démarré — polling média & audio actif")

    return app


async def _media_polling_task():
    """
    Tâche de fond qui interroge régulièrement le lecteur Windows
    et diffuse l'état à tous les clients connectés via WebSocket.
    """
    from services.windows_media import windows_media_service

    last_state: dict = {}

    while True:
        try:
            if ws_manager.client_count > 0:
                current_state = await windows_media_service.get_current_state()

                # N'envoie que si l'état a changé
                if current_state != last_state:
                    await ws_manager.broadcast(current_state)
                    last_state = current_state

        except Exception as e:
            logger.error(f"Erreur dans le polling média : {e}")

        await asyncio.sleep(settings.MEDIA_POLL_INTERVAL)


async def _audio_polling_task():
    """
    Tâche de fond qui interroge régulièrement l'état audio Windows (volume master + apps)
    et diffuse l'état à tous les clients connectés dès qu'un changement sur le PC est détecté.
    """
    from services.windows_audio import windows_audio_service

    last_state: dict = {}

    while True:
        try:
            if ws_manager.client_count > 0:
                current_state = await windows_audio_service.get_full_state()

                # N'envoie que si l'état audio a changé sur le PC
                if current_state != last_state:
                    await ws_manager.broadcast(current_state)
                    last_state = current_state

        except Exception as e:
            logger.error(f"Erreur dans le polling audio : {e}")

        await asyncio.sleep(0.5)
