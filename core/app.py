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

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware

from core.logger import get_logger
from core.websocket import handle_websocket, ws_manager
from core.shortcuts import router as shortcuts_router, verify_token
from core.telemetry import router as telemetry_router
from core.setup import router as setup_router
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
    app.include_router(setup_router)

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

    @app.get("/api/devices", dependencies=[Depends(verify_token)])
    async def get_devices():
        """
        Liste les appareils actuellement connectés au WebSocket (app
        compagnon, onglet Serveur/Appareils). En mémoire uniquement,
        réinitialisée à chaque redémarrage du serveur — voir
        core/websocket.py::WebSocketManager.list_devices.
        """
        return ws_manager.list_devices()

    @app.post("/api/devices/{device_id}/kick", dependencies=[Depends(verify_token)])
    async def kick_device(device_id: str):
        """Déconnecte de force l'appareil `device_id` (onglet Appareils de
        l'app compagnon — confirmation gérée côté client avant l'appel)."""
        ok = await ws_manager.kick(device_id)
        if not ok:
            raise HTTPException(status_code=404, detail=f"Appareil inconnu ou déjà déconnecté : {device_id}")
        return {"status": "ok", "device_id": device_id, "message": "Appareil déconnecté"}

    @app.get("/api/debug/media-poll")
    async def debug_media_poll():
        """
        Diagnostic de la tâche de fond de polling média (voir _media_poll_diag) —
        tick_count doit augmenter à chaque appel successif (~1x/s) si la tâche
        tourne. last_tick_at très ancien ou tick_count figé = tâche bloquée/morte.
        """
        diag = dict(_media_poll_diag)
        now = time.time()
        diag["seconds_since_last_tick"] = (now - diag["last_tick_at"]) if diag["last_tick_at"] else None
        diag["seconds_since_last_broadcast"] = (now - diag["last_broadcast_at"]) if diag["last_broadcast_at"] else None
        return diag

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
        if websocket.query_params.get("token") != settings.AUTH_TOKEN:
            await websocket.close(code=1008)
            return
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
    async def serve_index(request: Request):
        """
        Sert la page principale de l'interface, en injectant APP_VERSION
        pour forcer le rechargement du CSS/JS/fragments HTML à chaque
        redémarrage du serveur (contourne les caches tablette récalcitrants),
        et AUTH_TOKEN pour que le frontend puisse s'authentifier sur le
        WebSocket et les routes /shortcuts.

        Nécessite ?token=<AUTH_TOKEN> en query param — c'est la seule barrière
        d'accès à l'app (voir settings.AUTH_TOKEN dans config.py).
        """
        if request.query_params.get("token") != settings.AUTH_TOKEN:
            return PlainTextResponse(
                "Accès refusé — utilisez le lien complet avec le token "
                "(affiché dans les logs au démarrage du serveur).",
                status_code=403,
            )

        index_path = WEB_DIR / "index.html"
        if not index_path.exists():
            return JSONResponse({"error": "Frontend non trouvé"}, status_code=404)

        html = index_path.read_text(encoding="utf-8")
        html = html.replace("__APP_VERSION__", APP_VERSION)
        html = html.replace("__AUTH_TOKEN__", settings.AUTH_TOKEN)
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
        """Démarre le polling périodique de l'état média, audio et système Windows."""
        asyncio.create_task(_media_polling_task())
        asyncio.create_task(_audio_polling_task())
        asyncio.create_task(_system_polling_task())
        asyncio.create_task(_apps_polling_task())
        asyncio.create_task(_wifi_polling_task())
        asyncio.create_task(_game_covers_task())
        logger.info("Cockpit OS démarré — polling média, audio, système, applications, Wi-Fi & jaquettes de jeux actif")

    return app


#: Diagnostic en mémoire pour /api/debug/media-poll — permet de vérifier que
#: la tâche de fond tourne réellement (tick_count doit augmenter chaque
#: seconde) sans dépendre des logs console (non accessibles à distance).
#: Ajouté le 2026-09-05 pour investiguer un bug signalé : la notch/l'onglet
#: Médias ne se mettent pas à jour tout seuls après un changement de morceau
#: (un rechargement de page retrouve toujours le bon état, donc la lecture
#: à la demande fonctionne — seule la diffusion automatique semble en cause).
_media_poll_diag = {
    "tick_count": 0,
    "last_tick_at": None,
    "last_error": None,
    "last_broadcast_at": None,
    "last_broadcast_title": None,
    "last_client_count": None,
}


async def _media_polling_task():
    """
    Tâche de fond qui interroge régulièrement le lecteur Windows
    et diffuse l'état à tous les clients connectés via WebSocket.
    """
    from services.windows_media import windows_media_service

    last_state: dict = {}

    while True:
        _media_poll_diag["tick_count"] += 1
        _media_poll_diag["last_tick_at"] = time.time()
        _media_poll_diag["last_client_count"] = ws_manager.client_count
        try:
            if ws_manager.client_count > 0:
                current_state = await windows_media_service.get_current_state()

                # N'envoie que si l'état a changé
                if current_state != last_state:
                    await ws_manager.broadcast(current_state)
                    last_state = current_state
                    _media_poll_diag["last_broadcast_at"] = time.time()
                    _media_poll_diag["last_broadcast_title"] = current_state.get("title")

        except Exception as e:
            logger.error(f"Erreur dans le polling média : {e}")
            _media_poll_diag["last_error"] = f"{type(e).__name__}: {e}"

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


async def _system_polling_task():
    """
    Tâche de fond qui interroge régulièrement l'état système (CPU/RAM/
    disques/réseau/GPU, onglet Setup) et diffuse l'état à tous les clients
    connectés. Pas de diff-check ici : l'historique des sparklines change à
    chaque tick par nature, donc quasiment toujours "différent".
    """
    from services.system_monitor import system_monitor_service

    while True:
        try:
            if ws_manager.client_count > 0:
                # refresh_state() (pas get_current_state()) : c'est la seule
                # méthode qui doit déclencher une vraie lecture psutil, pour
                # que psutil.cpu_percent() mesure toujours sur un intervalle
                # d'~1s propre, jamais raccourci par une requête à la
                # demande concurrente (voir services/system_monitor.py).
                current_state = await system_monitor_service.refresh_state()
                await ws_manager.broadcast(current_state)

        except Exception as e:
            logger.error(f"Erreur dans le polling système : {e}")

        await asyncio.sleep(1.0)


async def _apps_polling_task():
    """
    Tâche de fond qui interroge périodiquement les applications ouvertes
    (fenêtres visibles + CPU/RAM/disque par processus, onglet Setup) et
    diffuse l'état à tous les clients connectés. Intervalle plus long que le
    polling système (2s vs 1s) : l'énumération de fenêtres + lecture par
    processus est plus coûteuse, et une grille d'apps n'a pas besoin de la
    même fraîcheur qu'un sparkline temps réel.
    """
    from services.process_monitor import process_monitor_service

    while True:
        try:
            if ws_manager.client_count > 0:
                current_state = await process_monitor_service.refresh_state()
                await ws_manager.broadcast(current_state)

        except Exception as e:
            logger.error(f"Erreur dans le polling applications : {e}")

        await asyncio.sleep(2.0)


async def _wifi_polling_task():
    """
    Tâche de fond qui interroge périodiquement l'état Wi-Fi (adaptateur,
    réseau connecté, réseaux visibles, onglet Setup) et diffuse l'état à
    tous les clients connectés. Intervalle plus long que les autres polls :
    chaque lecture lance un sous-processus netsh/PowerShell, plus coûteux
    qu'une lecture psutil — et diff-check comme le polling audio, l'état
    Wi-Fi ne change pas à chaque tick contrairement aux sparklines système.
    """
    from services.wifi_service import wifi_service

    last_state: dict = {}

    while True:
        try:
            if ws_manager.client_count > 0:
                current_state = await wifi_service.refresh_state()
                if current_state != last_state:
                    await ws_manager.broadcast(current_state)
                    last_state = current_state

        except Exception as e:
            logger.error(f"Erreur dans le polling Wi-Fi : {e}")

        await asyncio.sleep(3.0)


async def _game_covers_task():
    """
    Tâche de fond qui (1) recharge shortcuts_config.json s'il a changé
    depuis la dernière lecture — édition manuelle ou app compagnon
    CustomTkinter écrivant en parallèle — puis (2) lance la recherche de
    jaquette Steam pour tout jeu ("type":"game") qui n'en a pas encore.
    Pas de dépendance à un client WebSocket connecté (contrairement aux
    autres polls) : contrairement à la tablette, l'app compagnon peut
    éditer la config à tout moment, serveur affiché ou non sur la tablette.

    Se déclenche dès le démarrage (premier passage de la boucle, avant le
    premier sleep) pour rattraper les jeux déjà configurés sans jaquette,
    puis à chaque changement de fichier détecté ensuite — voir
    core/shortcuts.py::reload_shortcuts_config_if_changed. L'intervalle
    (8s) n'est qu'un stat() disque la plupart du temps ; le travail réel
    (recherche + téléchargement HTTP, services/steam_covers.py) ne se
    déclenche que pour les jeux réellement sans cover_path.
    """
    from core import shortcuts
    from services.steam_covers import fetch_missing_covers

    while True:
        try:
            shortcuts.reload_shortcuts_config_if_changed()
            missing = shortcuts.get_games_missing_cover()
            if missing:
                await fetch_missing_covers(missing)
        except Exception as e:
            logger.error(f"Erreur dans la récupération de jaquettes de jeux : {e}")

        await asyncio.sleep(8.0)
