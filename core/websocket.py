"""
Cockpit OS — Gestionnaire WebSocket
Toute la communication temps réel entre le frontend et le backend passe ici.
Le frontend ne communique JAMAIS directement avec les services Python.

Protocole :
  Frontend → Backend : {"type": "media.command", "command": "play"}
  Backend → Frontend : {"type": "media.state", "title": "...", "artist": "...", "status": "playing"}
"""

import asyncio
import json
from typing import Awaitable, Callable, Optional

from fastapi import WebSocket, WebSocketDisconnect

from core.logger import get_logger

logger = get_logger(__name__)


class WebSocketManager:
    """
    Gère toutes les connexions WebSocket actives.
    Centralise l'envoi de messages à tous les clients connectés.
    """

    def __init__(self):
        # Liste des connexions WebSocket actives
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accepte et enregistre une nouvelle connexion client."""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connecté. Total : {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket) -> None:
        """Supprime une connexion déconnectée de la liste active."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"Client déconnecté. Total : {len(self.active_connections)}")

    async def send_to_client(self, websocket: WebSocket, message: dict) -> None:
        """Envoie un message JSON à un client spécifique."""
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.warning(f"Erreur lors de l'envoi au client : {e}")

    async def broadcast(self, message: dict) -> None:
        """Diffuse un message JSON à tous les clients connectés."""
        if not self.active_connections:
            return

        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                disconnected.append(connection)

        # Nettoyage des connexions mortes
        for conn in disconnected:
            self.disconnect(conn)

    @property
    def client_count(self) -> int:
        """Nombre de clients actuellement connectés."""
        return len(self.active_connections)


# Instance unique partagée dans toute l'application
ws_manager = WebSocketManager()


async def handle_websocket(websocket: WebSocket) -> None:
    """
    Gère le cycle de vie complet d'une connexion WebSocket.
    - Accepte la connexion
    - Traite les messages entrants
    - Gère la déconnexion proprement
    """
    await ws_manager.connect(websocket)

    # Message de bienvenue envoyé au client
    await ws_manager.send_to_client(websocket, {
        "type": "system.connected",
        "message": "Cockpit OS connecté",
        "clients": ws_manager.client_count,
    })

    try:
        while True:
            # Attente d'un message du client
            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(f"Message JSON invalide reçu : {raw[:100]}")
                await ws_manager.send_to_client(websocket, {
                    "type": "error",
                    "message": "Format JSON invalide",
                })
                continue  # Connexion conservée — on passe au message suivant

            # Chaque message est isolé : une erreur de traitement ne déconnecte pas le client
            try:
                await _dispatch_message(websocket, data)
            except Exception as dispatch_err:
                logger.error(f"Erreur lors du traitement du message '{data.get('type')}' : {dispatch_err}")
                await ws_manager.send_to_client(websocket, {
                    "type": "error",
                    "message": f"Erreur interne lors du traitement : {str(dispatch_err)}",
                })
                # La connexion reste ouverte

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

    except Exception as e:
        logger.error(f"Erreur WebSocket inattendue : {e}")
        ws_manager.disconnect(websocket)


async def _handle_media_command(websocket: WebSocket, data: dict) -> None:
    """Commandes média Windows."""
    from services.windows_media import windows_media_service
    result = await windows_media_service.handle_command(data.get("command", ""), data)
    await ws_manager.broadcast(result)


async def _handle_game_action(websocket: WebSocket, data: dict) -> None:
    """Commandes de jeu / simulation."""
    action = data.get("action", "")
    key = data.get("key", "")
    logger.info(f"WS [game.action] -> action={action}, key={key}")
    try:
        import pyautogui
        if action == "escape" or key == "Escape":
            pyautogui.press('escape')
        elif action == "exit":
            pyautogui.hotkey('alt', 'f4')
    except Exception as e:
        logger.debug(f"pyautogui non disponible : {e}")

    await ws_manager.send_to_client(websocket, {
        "type": "game.action.ack",
        "action": action,
        "status": "ok"
    })


async def _handle_audio_command(websocket: WebSocket, data: dict) -> None:
    """Commandes audio & Bluetooth Windows."""
    from services.windows_audio import windows_audio_service
    cmd = data.get("command", "")
    result = await windows_audio_service.handle_command(data)
    await ws_manager.broadcast(result)
    if cmd not in ("audio.volume.set", "audio.app.volume.set"):
        full_audio_state = await windows_audio_service.get_full_state()
        await ws_manager.broadcast(full_audio_state)


async def _handle_wifi_command(websocket: WebSocket, data: dict) -> None:
    """Commandes Wi-Fi (bascule adaptateur, connexion à un réseau)."""
    from services.wifi_service import wifi_service
    result = await wifi_service.handle_command(data)
    await ws_manager.broadcast(result)
    # Rafraîchit et rediffuse tout de suite (plutôt que d'attendre le prochain
    # tick de _wifi_polling_task) pour un retour visuel rapide après une
    # action explicite — cf. _handle_audio_command, même principe.
    fresh_state = await wifi_service.refresh_state()
    await ws_manager.broadcast(fresh_state)


async def _handle_wifi_state_request(websocket: WebSocket, data: dict) -> None:
    """Demande de l'état Wi-Fi actuel (onglet Setup)."""
    from services.wifi_service import wifi_service
    state = await wifi_service.get_current_state()
    await ws_manager.send_to_client(websocket, state)


async def _handle_deezer_search(websocket: WebSocket, data: dict) -> None:
    """Recherche Deezer."""
    from services.deezer_api import deezer_api_service
    results = await deezer_api_service.search(data.get("query", ""), data.get("filter", "track"))
    await ws_manager.send_to_client(websocket, {
        "type": "deezer.search.results",
        "results": results,
        "filter": data.get("filter", "track"),
    })


async def _handle_deezer_playlists(websocket: WebSocket, data: dict) -> None:
    """Playlists Deezer."""
    from services.deezer_api import deezer_api_service
    playlists = await deezer_api_service.get_user_playlists()
    await ws_manager.send_to_client(websocket, {
        "type": "deezer.playlists.results",
        "playlists": playlists,
    })


async def _handle_deezer_playlist_tracks(websocket: WebSocket, data: dict) -> None:
    """Morceaux d'une playlist."""
    from services.deezer_api import deezer_api_service
    import asyncio
    playlist_id = data.get("playlist_id")

    # 1. Charger et envoyer TRÈS RAPIDEMENT les 100 premiers morceaux pour afficher l'interface instantanément
    try:
        tracks_fast, is_owner = await deezer_api_service.get_playlist_tracks(playlist_id, limit=100)
        await ws_manager.send_to_client(websocket, {
            "type": "deezer.playlist.tracks.results",
            "tracks": tracks_fast,
            "playlist_id": playlist_id,
            "is_owner": is_owner,
            "is_partial": True
        })
    except Exception as e:
        logger.error(f"Erreur lors du chargement rapide de la playlist : {e}")
        tracks_fast, is_owner = [], False

    # 2. Charger l'intégralité en tâche de fond pour ne pas bloquer l'interface
    async def fetch_full_tracks_and_send():
        try:
            tracks_full, is_owner_full = await deezer_api_service.get_playlist_tracks(playlist_id, limit=2000)
            await ws_manager.send_to_client(websocket, {
                "type": "deezer.playlist.tracks.results",
                "tracks": tracks_full,
                "playlist_id": playlist_id,
                "is_owner": is_owner_full,
                "is_partial": False
            })
        except Exception as e:
            logger.error(f"Erreur lors du chargement complet de la playlist en tâche de fond : {e}")

    asyncio.create_task(fetch_full_tracks_and_send())


async def _handle_deezer_play(websocket: WebSocket, data: dict) -> None:
    """Lancer une piste Deezer."""
    try:
        from services.deezer_player import deezer_player_service
        track_id = data.get("track_id")
        title = data.get("title", "")
        source = data.get("source")
        playlist_id = data.get("playlist_id")
        album_id = data.get("album_id")
        index = data.get("index")
        loved_tracks_id = data.get("loved_tracks_id")
        queue_track_ids = data.get("queue_track_ids")

        # Déduction de la source par rétro-compatibilité si non spécifiée
        if not source:
            if playlist_id:
                source = "playlist"
            elif album_id:
                source = "album"
            else:
                source = "search"

        logger.info(f"WS [deezer.play] -> track_id={track_id}, title={title!r}, source={source}, playlist_id={playlist_id}, album_id={album_id}, index={index}")

        result = await deezer_player_service.play_track(
            track_id=track_id,
            title=title,
            source=source,
            playlist_id=playlist_id,
            album_id=album_id,
            index=index,
            loved_tracks_id=loved_tracks_id,
            queue_track_ids=queue_track_ids,
        )
        logger.info(f"WS [deezer.play] <- Résultat CDP : {result}")
        await ws_manager.send_to_client(websocket, result)
    except Exception as e:
        logger.exception("WS [deezer.play] <- Exception fatale lors du lancement de la piste")
        await ws_manager.send_to_client(websocket, {
            "type": "deezer.player.error",
            "track_id": data.get("track_id"),
            "title": data.get("title", ""),
            "message": f"Erreur interne du serveur : {str(e)}"
        })


async def _handle_media_state_request(websocket: WebSocket, data: dict) -> None:
    """Demande de l'état média actuel."""
    from services.windows_media import windows_media_service
    state = await windows_media_service.get_current_state()
    await ws_manager.send_to_client(websocket, state)


async def _handle_audio_state_request(websocket: WebSocket, data: dict) -> None:
    """Demande de l'état audio actuel."""
    from services.windows_audio import windows_audio_service
    state = await windows_audio_service.get_full_state()
    await ws_manager.send_to_client(websocket, state)


async def _handle_system_state_request(websocket: WebSocket, data: dict) -> None:
    """Demande de l'état système actuel (onglet Setup)."""
    from services.system_monitor import system_monitor_service
    state = await system_monitor_service.get_current_state()
    await ws_manager.send_to_client(websocket, state)


async def _handle_apps_state_request(websocket: WebSocket, data: dict) -> None:
    """Demande de l'état des applications ouvertes actuel (onglet Setup)."""
    from services.process_monitor import process_monitor_service
    state = await process_monitor_service.get_current_state()
    await ws_manager.send_to_client(websocket, state)


async def _handle_deezer_artist_albums(websocket: WebSocket, data: dict) -> None:
    """Albums d'un artiste."""
    from services.deezer_api import deezer_api_service
    albums = await deezer_api_service.get_artist_albums(data.get("artist_id"))
    await ws_manager.send_to_client(websocket, {
        "type": "deezer.artist.albums.results",
        "albums": albums,
        "artist_id": data.get("artist_id"),
    })


async def _handle_deezer_album_tracks(websocket: WebSocket, data: dict) -> None:
    """Morceaux d'un album."""
    from services.deezer_api import deezer_api_service
    tracks = await deezer_api_service.get_album_tracks(data.get("album_id"))
    await ws_manager.send_to_client(websocket, {
        "type": "deezer.album.tracks.results",
        "tracks": tracks,
        "album_id": data.get("album_id"),
    })


# Registre des handlers par type de message. "audio.command" et "bluetooth.command"
# partagent le même handler (windows_audio_service route déjà sur data["command"]).
_HANDLERS: dict[str, Callable[[WebSocket, dict], Awaitable[None]]] = {
    "media.command": _handle_media_command,
    "game.action": _handle_game_action,
    "audio.command": _handle_audio_command,
    "bluetooth.command": _handle_audio_command,
    "wifi.command": _handle_wifi_command,
    "wifi.state.request": _handle_wifi_state_request,
    "deezer.search": _handle_deezer_search,
    "deezer.playlists": _handle_deezer_playlists,
    "deezer.playlist.tracks": _handle_deezer_playlist_tracks,
    "deezer.play": _handle_deezer_play,
    "media.state.request": _handle_media_state_request,
    "audio.state.request": _handle_audio_state_request,
    "system.state.request": _handle_system_state_request,
    "apps.state.request": _handle_apps_state_request,
    "deezer.artist.albums": _handle_deezer_artist_albums,
    "deezer.album.tracks": _handle_deezer_album_tracks,
}


async def _dispatch_message(websocket: WebSocket, data: dict) -> None:
    """
    Aiguille les messages entrants vers le bon service via le registre _HANDLERS.
    """
    msg_type = data.get("type", "")
    logger.debug(f"Message reçu : {msg_type}")

    handler = _HANDLERS.get(msg_type)
    if handler is None:
        logger.warning(f"Type de message inconnu : {msg_type}")
        await ws_manager.send_to_client(websocket, {
            "type": "error",
            "message": f"Type de message non reconnu : {msg_type}",
        })
        return

    await handler(websocket, data)
