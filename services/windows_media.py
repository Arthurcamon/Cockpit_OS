"""
Cockpit OS — Service Windows Media Session
Contrôle le lecteur multimédia actif Windows via Windows Media Session API.

Compatible avec : Firefox, Chrome, Spotify, VLC, Deezer Desktop, et tout
lecteur qui s'affiche dans le panneau de notifications Windows.

IMPORTANT — Dépendances Windows :
  pip install winsdk

ARCHITECTURE — isolation du thread :
  Les appels winsdk (WinRT IAsyncOperation) s'avèrent bloquer la boucle
  asyncio principale même quand on les `await`. Tous les appels winsdk sont
  donc exécutés dans asyncio.to_thread() avec asyncio.run() dans le thread,
  ce qui garantit que la boucle principale reste réactive (WebSocket pings OK).
"""

import asyncio
import platform
import base64

from core.logger import get_logger

logger = get_logger(__name__)

IS_WINDOWS = platform.system() == "Windows"

if IS_WINDOWS:
    try:
        from winsdk.windows.media.control import (
            GlobalSystemMediaTransportControlsSessionManager as MediaManager,
        )
        from winsdk.windows.storage.streams import DataReader, Buffer, InputStreamOptions
        WINSDK_AVAILABLE = True
        logger.info("winsdk chargé — contrôle Windows Media Session actif")
    except ImportError as e:
        WINSDK_AVAILABLE = False
        logger.warning(f"winsdk non installé — mode simulation activé ({e})")
else:
    WINSDK_AVAILABLE = False
    logger.info("Système non-Windows détecté — mode simulation activé")

# Noms de processus Deezer (priorité)
DEEZER_PROCESS_NAMES = {"deezer", "deezer.exe"}


def _safe_get_attr(obj, *attrs, default=None):
    """Remonte une chaîne d'attributs sans lever d'exception."""
    try:
        for attr in attrs:
            obj = getattr(obj, attr)
        return obj
    except Exception:
        return default


class WindowsMediaService:
    """
    Contrôle le lecteur multimédia actif via Windows Media Session API.
    Fournit un état détaillé et des commandes de contrôle.

    Toutes les méthodes publiques sont async et peuvent être appelées
    depuis la boucle asyncio principale sans la bloquer.
    """

    def __init__(self):
        self._simulation_state = {
            "type": "media.state",
            "title": "",
            "artist": "",
            "album": "",
            "status": "stopped",
            "duration": 0,
            "position": 0,
            "cover_b64": None,
            "shuffle": False,
            "repeat": "none",
            "player": "",
            "source": "simulation",
        }
        # Cache pochette : évite de relire les octets à chaque poll
        # Clé = "title|||artist", valeur = data-URI base64
        self._cover_cache_key: str = ""
        self._cover_cache_data: str | None = None

        # Session sélectionnée manuellement par l'utilisateur (source_app_user_model_id)
        # None = sélection automatique (Deezer en priorité, sinon session courante)
        self._selected_source: str | None = None

        # Cache court du shuffle/repeat Deezer lu via CDP (voir plus bas) — évite
        # d'ouvrir une nouvelle connexion WebSocket CDP à chaque poll média (1x/s).
        self._dz_shuffle_repeat_cache: dict | None = None
        self._dz_shuffle_repeat_cache_at: float = 0.0
        self._DZ_CACHE_TTL = 3.0

        # Dernier état connu avec une piste — certains lecteurs (Deezer Desktop
        # notamment) retirent purement et simplement leur session Windows Media
        # dès qu'ils sont mis en pause, au lieu de rester présents avec le statut
        # "Paused". Sans ce cache, l'app afficherait "Aucune lecture en cours" au
        # lieu de "en pause" avec le titre — ce qui donne l'impression que les
        # boutons play/pause ne sont pas synchronisés avec l'ordinateur.
        self._last_known_state: dict | None = None
        self._last_known_at: float = 0.0
        self._LAST_KNOWN_TTL = 30.0  # secondes avant d'abandonner le fallback

    # ── Lecture de l'état (point d'entrée public) ──────────────────────────

    async def get_current_state(self) -> dict:
        """
        Retourne l'état courant du lecteur.
        Exécuté dans un thread dédié pour ne pas bloquer la boucle asyncio.
        """
        if WINSDK_AVAILABLE:
            return await asyncio.to_thread(self._run_state_in_thread)
        return {**self._simulation_state, "source": "simulation"}

    def _run_state_in_thread(self) -> dict:
        """
        Wrapper synchrone : lance _get_windows_state() dans une nouvelle
        boucle asyncio propre au thread executor.
        """
        return asyncio.run(self._get_windows_state())

    # ── Lecture de l'état Windows (dans le thread) ────────────────────────

    async def _get_windows_state(self) -> dict:
        """Interroge Windows Media Session de façon robuste, étape par étape."""
        base = {
            "type": "media.state",
            "title": "",
            "artist": "",
            "album": "",
            "status": "stopped",
            "duration": 0,
            "position": 0,
            "cover_b64": None,
            "shuffle": False,
            "repeat": "none",
            "capabilities": {},
            "player": "",
            "source": "windows",
        }

        try:
            manager = await MediaManager.request_async()
        except Exception as e:
            logger.error(f"MediaManager.request_async() a échoué : {e}")
            return {**base, "error": str(e)}

        # Liste légère de toutes les sessions (sync — pas de surcoût async)
        base["sessions"] = self._list_sessions_sync(manager, self._selected_source)

        try:
            session = await self._get_best_session(manager)
        except Exception as e:
            logger.error(f"_get_best_session() a échoué : {e}")
            return self._with_last_known_fallback(base)

        if not session:
            logger.debug("Aucune session média active")
            return self._with_last_known_fallback(base)

        # Nom du lecteur source
        is_deezer = False
        try:
            source_app = _safe_get_attr(session, "source_app_user_model_id", default="")
            base["player"] = source_app.split("!")[-1].split(".exe")[0] if source_app else ""
            is_deezer = any(name in source_app.lower() for name in DEEZER_PROCESS_NAMES)
            if is_deezer:
                base["player"] = "Deezer Desktop"
        except Exception:
            pass

        # Informations sur la piste
        info = None
        try:
            info = await session.try_get_media_properties_async()
            if info:
                base["title"] = info.title or ""
                base["artist"] = info.artist or ""
                base["album"] = info.album_title or ""
        except Exception as e:
            logger.warning(f"try_get_media_properties_async() a échoué : {e}")

        # Statut de lecture
        try:
            pb = session.get_playback_info()
            if pb:
                status_val = _safe_get_attr(pb, "playback_status", "value", default=0)
                # Valeurs de l'énum WinRT GlobalSystemMediaTransportControlsSessionPlaybackStatus :
                # Closed=0, Opened=1, Changing=2, Stopped=3, Playing=4, Paused=5.
                # (L'ancien mapping ici associait à tort 4 à "rewinding" et 2 à "playing",
                # ce qui faisait que le bouton play/pause de l'app ne reflétait jamais le
                # vrai statut de lecture Windows.)
                status_map = {
                    0: "stopped", 1: "stopped", 2: "buffering",
                    3: "stopped", 4: "playing", 5: "paused",
                }
                base["status"] = status_map.get(status_val, "unknown")

                # Capacités
                try:
                    controls = pb.controls
                    base["capabilities"] = {
                        "can_play":     _safe_get_attr(controls, "is_play_enabled", default=False),
                        "can_pause":    _safe_get_attr(controls, "is_pause_enabled", default=False),
                        "can_next":     _safe_get_attr(controls, "is_next_enabled", default=False),
                        "can_previous": _safe_get_attr(controls, "is_previous_enabled", default=False),
                        "can_seek":     _safe_get_attr(controls, "is_playback_position_enabled", default=False),
                    }
                except Exception:
                    pass

                # Shuffle / Repeat
                base["shuffle"] = bool(_safe_get_attr(pb, "is_shuffle_active", default=False))
                repeat_mode = _safe_get_attr(pb, "auto_repeat_mode", default=None)
                if repeat_mode is not None:
                    base["repeat"] = {0: "none", 1: "track", 2: "list"}.get(
                        _safe_get_attr(repeat_mode, "value", default=0), "none"
                    )
        except Exception as e:
            logger.warning(f"get_playback_info() a échoué : {e}")

        # Deezer ne remonte jamais son shuffle/repeat réel via SMTC (vérifié : ces
        # champs restent à leur valeur par défaut quoi qu'il arrive côté Deezer) —
        # on les relit directement depuis dzPlayer via CDP quand c'est disponible.
        # Mis en cache quelques secondes pour éviter une connexion CDP à chaque
        # poll média (1x/s).
        if is_deezer:
            try:
                import time
                now = time.time()
                if self._dz_shuffle_repeat_cache is None or (now - self._dz_shuffle_repeat_cache_at) >= self._DZ_CACHE_TTL:
                    from services.deezer_player import deezer_player_service
                    dz_state = await deezer_player_service.get_player_state()
                    if dz_state is not None:
                        self._dz_shuffle_repeat_cache = dz_state
                        self._dz_shuffle_repeat_cache_at = now
                if self._dz_shuffle_repeat_cache is not None:
                    base["shuffle"] = bool(self._dz_shuffle_repeat_cache.get("shuffle", False))
                    base["repeat"] = {0: "none", 1: "track", 2: "list"}.get(self._dz_shuffle_repeat_cache.get("repeat", 0), "none")
            except Exception as e:
                logger.debug(f"Lecture shuffle/repeat Deezer via CDP échouée : {e}")

        # Position et durée
        try:
            timeline = session.get_timeline_properties()
            if timeline:
                end = _safe_get_attr(timeline, "end_time", default=None)
                pos = _safe_get_attr(timeline, "position", default=None)
                if end:
                    base["duration"] = round(end.total_seconds())
                if pos:
                    base["position"] = round(pos.total_seconds())
        except Exception as e:
            logger.debug(f"get_timeline_properties() a échoué (normal pour certains lecteurs) : {e}")

        # ── Pochette en base64 (avec cache par piste) ─────────────────────
        # La pochette est la lecture la plus coûteuse (lecture de flux binaire).
        # On ne la relit que quand la piste change (titre + artiste).
        track_key = f"{base['title']}|||{base['artist']}"
        if track_key == self._cover_cache_key and self._cover_cache_data is not None:
            # Piste identique → réutilise le cache
            base["cover_b64"] = self._cover_cache_data
        else:
            # Piste différente → lit la nouvelle pochette
            cover_data: str | None = None
            try:
                thumbnail = _safe_get_attr(info, "thumbnail", default=None) if info else None
                if thumbnail:
                    stream = await thumbnail.open_read_async()
                    size = stream.size
                    if size and size > 0:
                        buffer = Buffer(size)
                        # IMPORTANT : read_async renvoie l'IBuffer réellement rempli.
                        # Il ne faut PAS réutiliser le `buffer` d'entrée après l'appel,
                        # sous peine de relire un buffer vide (bug silencieux fréquent
                        # avec la projection Python de WinRT).
                        filled_buffer = await stream.read_async(
                            buffer, size, InputStreamOptions.READ_AHEAD
                        )
                        reader = DataReader.from_buffer(filled_buffer)
                        # DataReader.read_bytes() ne renvoie rien : il faut lui passer
                        # un bytearray déjà alloué qu'il remplit en place (comme un
                        # out-param COM), pas une taille en entier.
                        raw = bytearray(filled_buffer.length)
                        reader.read_bytes(raw)
                        data_bytes = bytes(raw)
                        if data_bytes:
                            cover_data = (
                                "data:image/jpeg;base64,"
                                + base64.b64encode(bytes(data_bytes)).decode()
                            )
                        else:
                            logger.warning("Pochette : buffer lu mais vide (0 octet)")
                    else:
                        logger.debug("Pochette : thumbnail présent mais taille nulle")
                else:
                    logger.debug("Pochette : aucun thumbnail fourni par ce lecteur")
            except Exception as e:
                logger.warning(f"Lecture de la pochette échouée ({type(e).__name__}) : {e}")

            self._cover_cache_key = track_key
            self._cover_cache_data = cover_data
            base["cover_b64"] = cover_data

        if base["title"]:
            import time
            self._last_known_state = {**base}
            self._last_known_at = time.time()

        return base

    def _with_last_known_fallback(self, base: dict) -> dict:
        """
        Appelée quand plus aucune session Windows Media n'est active. Certains
        lecteurs (Deezer Desktop) désenregistrent leur session dès la mise en
        pause au lieu de rester présents avec le statut "Paused" — sans ce
        fallback, l'app afficherait à tort "Aucune lecture" et les boutons
        play/pause paraîtraient désynchronisés de l'ordinateur.
        """
        import time
        if self._last_known_state and (time.time() - self._last_known_at) < self._LAST_KNOWN_TTL:
            return {**self._last_known_state, "status": "paused", "sessions": base.get("sessions", [])}
        return base

    # ── Sélection de la session ───────────────────────────────────────────

    @staticmethod
    def _is_deezer_session(session) -> bool:
        try:
            source_app = (_safe_get_attr(session, "source_app_user_model_id", default="") or "").lower()
            return any(name in source_app for name in DEEZER_PROCESS_NAMES)
        except Exception:
            return False

    # ── Utilitaire : nom lisible d'une source ─────────────────────────────

    @staticmethod
    def _source_to_player_name(source_id: str) -> str:
        """Convertit un source_app_user_model_id en nom lisible."""
        low = (source_id or "").lower()
        if "deezer" in low:    return "Deezer"
        if "spotify" in low:   return "Spotify"
        if "firefox" in low:   return "Firefox"
        if "chrome" in low:    return "Chrome"
        if "msedge" in low or "edge" in low: return "Edge"
        if "opera" in low:     return "Opera"
        if "vlc" in low:       return "VLC"
        if "foobar" in low:    return "foobar2000"
        if "itunes" in low or "apple" in low: return "iTunes"
        if "groove" in low:    return "Groove"
        if "wmplayer" in low:  return "Windows Media"
        # Fallback : dernier segment de l'ID
        raw = source_id.split("!")[-1].split(".exe")[0]
        return raw.replace(".", " ").title()

    # ── Liste légère de toutes les sessions (sync, rapide) ────────────────

    @staticmethod
    def _list_sessions_sync(manager, selected_source: str | None) -> list[dict]:
        """
        Retourne la liste de toutes les sessions actives avec leurs infos de base.
        Utilise uniquement des appels synchrones (get_sessions, get_playback_info)
        pour rester rapide — pas d'attente async.
        """
        result = []
        try:
            sessions = manager.get_sessions()
            count = 0
            try:
                count = len(sessions)
            except Exception:
                count = _safe_get_attr(sessions, "size", default=0)

            # Mêmes valeurs d'énum que dans _get_windows_state() ci-dessus.
            status_map = {
                0: "stopped", 1: "stopped", 2: "buffering",
                3: "stopped", 4: "playing", 5: "paused",
            }

            for i in range(count):
                try:
                    s = sessions[i] if hasattr(sessions, '__getitem__') else sessions.get_at(i)
                    source_id = _safe_get_attr(s, "source_app_user_model_id", default="") or ""
                    pb = s.get_playback_info()
                    status_val = _safe_get_attr(pb, "playback_status", "value", default=0)
                    result.append({
                        "source_id": source_id,
                        "player_name": WindowsMediaService._source_to_player_name(source_id),
                        "status": status_map.get(status_val, "stopped"),
                        "is_selected": (source_id == selected_source),
                    })
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"_list_sessions_sync échoué : {e}")
        return result

    async def _get_best_session(self, manager):
        """
        Choisit la session à contrôler.
        Priorité : session sélectionnée manuellement > Deezer > session courante.
        """
        sessions_raw = None
        try:
            sessions_raw = manager.get_sessions()
            count = 0
            try:
                count = len(sessions_raw)
            except Exception:
                count = _safe_get_attr(sessions_raw, "size", default=0)
        except Exception as e:
            logger.debug(f"get_sessions() échoué : {e}")
            count = 0

        def _get_at(i):
            if sessions_raw is None:
                return None
            try:
                return sessions_raw[i] if hasattr(sessions_raw, '__getitem__') else sessions_raw.get_at(i)
            except Exception:
                return None

        # 1. Session sélectionnée manuellement
        if self._selected_source and count > 0:
            for i in range(count):
                s = _get_at(i)
                if s is None:
                    continue
                try:
                    source_id = _safe_get_attr(s, "source_app_user_model_id", default="")
                    if source_id == self._selected_source:
                        logger.debug(f"Session sélectionnée manuellement : {source_id}")
                        return s
                except Exception:
                    continue
            # La session sélectionnée n'existe plus — on réinitialise
            logger.debug("Session sélectionnée introuvable (fermée ?) — sélection automatique")
            self._selected_source = None

        # 2. Chercher Deezer parmi toutes les sessions
        for i in range(count):
            s = _get_at(i)
            if s is None:
                continue
            try:
                source_id = (_safe_get_attr(s, "source_app_user_model_id") or "").lower()
                if any(name in source_id for name in DEEZER_PROCESS_NAMES):
                    logger.debug(f"Session Deezer trouvée : {source_id}")
                    return s
            except Exception:
                continue

        # 3. Session courante (focus audio Windows)
        try:
            session = manager.get_current_session()
            if session:
                source = _safe_get_attr(session, "source_app_user_model_id", default="inconnu")
                logger.debug(f"Session courante utilisée : {source}")
                return session
        except Exception as e:
            logger.warning(f"get_current_session() a échoué : {e}")

        return None

    # ── Commandes de contrôle ─────────────────────────────────────────────

    async def handle_command(self, command: str, data: dict = None) -> dict:
        """
        Commandes acceptées :
          play, pause, toggle, next, previous,
          shuffle.toggle, repeat.cycle,
          seek (data["position"] en secondes)

        Exécuté dans un thread dédié pour ne pas bloquer la boucle asyncio.
        """
        command = command.lower().strip()
        data = data or {}

        # session.select ne fait pas d'appel WinRT — traité directement ici
        if command == "session.select":
            source_id = data.get("source_id") or None
            self._selected_source = source_id
            self._cover_cache_key = ""   # force relecture pochette nouvelle session
            logger.info(f"Session sélectionnée : {source_id or '(auto)'}")
            return await self.get_current_state()

        if WINSDK_AVAILABLE:
            return await asyncio.to_thread(self._run_command_in_thread, command, data)
        return await self._simulate_command(command)

    def _run_command_in_thread(self, command: str, data: dict) -> dict:
        """
        Wrapper synchrone : lance _execute_windows_command() dans une nouvelle
        boucle asyncio propre au thread executor.
        """
        return asyncio.run(self._execute_windows_command(command, data))

    async def _execute_windows_command(self, command: str, data: dict) -> dict:
        try:
            manager = await MediaManager.request_async()
            session = await self._get_best_session(manager)

            if not session:
                return {**await self._get_windows_state(), "command_error": "Aucune session active"}

            if command == "play":
                await session.try_play_async()
            elif command == "pause":
                await session.try_pause_async()
            elif command == "toggle":
                await session.try_toggle_play_pause_async()
            elif command == "next":
                await session.try_skip_next_async()
            elif command == "previous":
                await session.try_skip_previous_async()
            elif command == "shuffle.toggle":
                if self._is_deezer_session(session):
                    # SMTC ne reflète jamais le shuffle/repeat de Deezer (vérifié : ni la
                    # lecture ni l'écriture ne fonctionnent) — on pilote dzPlayer directement,
                    # y compris pour connaître l'état actuel avant de le basculer.
                    import time
                    from services.deezer_player import deezer_player_service
                    if self._dz_shuffle_repeat_cache is None:
                        self._dz_shuffle_repeat_cache = await deezer_player_service.get_player_state() or {}
                    current = bool(self._dz_shuffle_repeat_cache.get("shuffle", False))
                    result = await deezer_player_service.set_shuffle(not current)
                    if result is None:
                        logger.warning("shuffle.toggle Deezer : CDP indisponible, ignoré")
                    else:
                        self._dz_shuffle_repeat_cache["shuffle"] = result
                        self._dz_shuffle_repeat_cache_at = time.time()
                else:
                    pb = session.get_playback_info()
                    current = bool(_safe_get_attr(pb, "is_shuffle_active", default=False))
                    await session.try_change_shuffle_active_async(not current)
            elif command == "repeat.cycle":
                if self._is_deezer_session(session):
                    import time
                    from services.deezer_player import deezer_player_service
                    result = await deezer_player_service.cycle_repeat()
                    if result is None:
                        logger.warning("repeat.cycle Deezer : CDP indisponible, ignoré")
                    else:
                        self._dz_shuffle_repeat_cache = {**(self._dz_shuffle_repeat_cache or {}), "repeat": result}
                        self._dz_shuffle_repeat_cache_at = time.time()
                else:
                    pb = session.get_playback_info()
                    mode = _safe_get_attr(pb, "auto_repeat_mode", default=None)
                    current_val = _safe_get_attr(mode, "value", default=0)
                    next_val = {0: 2, 2: 1, 1: 0}.get(current_val, 0)
                    from winsdk.windows.media import MediaPlaybackAutoRepeatMode
                    await session.try_change_auto_repeat_mode_async(
                        MediaPlaybackAutoRepeatMode(next_val)
                    )
            elif command == "seek":
                position_sec = float(data.get("position", 0))
                timeline = session.get_timeline_properties()
                if timeline:
                    duration_sec = _safe_get_attr(timeline, "end_time", default=None)
                    if duration_sec:
                        duration_sec = duration_sec.total_seconds()
                        position_sec = max(0.0, min(position_sec, duration_sec))
                ticks = int(position_sec * 10_000_000)
                await session.try_change_playback_position_async(ticks)
            else:
                logger.warning(f"Commande média inconnue : {command}")

            # Laisse le lecteur se mettre à jour avant de relire l'état
            await asyncio.sleep(0.3)

            # Invalide le cache pochette pour la prochaine lecture d'état
            # (seek/shuffle/repeat ne changent pas la piste — pas besoin)
            if command in ("next", "previous"):
                self._cover_cache_key = ""

            return await self._get_windows_state()

        except Exception as e:
            logger.error(f"Erreur commande Windows Media ({command}) : {e}")
            return {"type": "error", "message": str(e)}

    # ── Simulation (non-Windows) ──────────────────────────────────────────

    async def _simulate_command(self, command: str) -> dict:
        state = self._simulation_state
        if command == "play":
            state["status"] = "playing"
        elif command == "pause":
            state["status"] = "paused"
        elif command == "toggle":
            state["status"] = "paused" if state["status"] == "playing" else "playing"
        elif command == "next":
            state["title"] = "Get Lucky"
            state["position"] = 0
        elif command == "previous":
            state["title"] = "Harder, Better, Faster, Stronger"
            state["position"] = 0
        return {**state}

    # ── Diagnostic ────────────────────────────────────────────────────────

    async def get_diagnostic(self) -> dict:
        """
        Retourne un état de diagnostic complet pour déboguer.
        Accessible via GET /api/debug/media
        """
        result = {
            "winsdk_available": WINSDK_AVAILABLE,
            "is_windows": IS_WINDOWS,
            "sessions": [],
            "current_session": None,
            "error": None,
        }

        if not WINSDK_AVAILABLE:
            result["error"] = "winsdk non disponible (Linux ou non installé)"
            return result

        # Exécuté dans un thread pour ne pas bloquer
        return await asyncio.to_thread(
            lambda: asyncio.run(self._get_diagnostic_async(result))
        )

    async def _get_diagnostic_async(self, result: dict) -> dict:
        try:
            manager = await MediaManager.request_async()
            result["manager_ok"] = True
        except Exception as e:
            result["error"] = f"MediaManager.request_async() a échoué : {e}"
            return result

        try:
            sessions = manager.get_sessions()
            count = 0
            try:
                count = len(sessions)
            except Exception:
                count = _safe_get_attr(sessions, "size", default=0)

            result["session_count"] = count

            for i in range(count):
                try:
                    s = sessions[i] if hasattr(sessions, '__getitem__') else sessions.get_at(i)
                    source = _safe_get_attr(s, "source_app_user_model_id", default="?")
                    pb = s.get_playback_info()
                    status_val = _safe_get_attr(pb, "playback_status", "value", default=-1)
                    info = await s.try_get_media_properties_async()
                    result["sessions"].append({
                        "index": i,
                        "source": source,
                        "status_value": status_val,
                        "title": _safe_get_attr(info, "title", default=""),
                        "artist": _safe_get_attr(info, "artist", default=""),
                    })
                except Exception as e:
                    result["sessions"].append({"index": i, "error": str(e)})

        except Exception as e:
            result["sessions_error"] = f"get_sessions() a échoué : {e}"

        try:
            current = manager.get_current_session()
            if current:
                source = _safe_get_attr(current, "source_app_user_model_id", default="?")
                pb = current.get_playback_info()
                info = await current.try_get_media_properties_async()
                result["current_session"] = {
                    "source": source,
                    "title": _safe_get_attr(info, "title", default=""),
                    "artist": _safe_get_attr(info, "artist", default=""),
                    "status_value": _safe_get_attr(pb, "playback_status", "value", default=-1),
                }

                # Test réel d'extraction de pochette — pour diagnostiquer sans deviner
                cover_diag = {"attempted": False}
                try:
                    thumbnail = _safe_get_attr(info, "thumbnail", default=None) if info else None
                    cover_diag["thumbnail_present"] = thumbnail is not None
                    if thumbnail:
                        cover_diag["attempted"] = True
                        stream = await thumbnail.open_read_async()
                        size = stream.size
                        cover_diag["stream_size"] = size
                        if size and size > 0:
                            buffer = Buffer(size)
                            filled_buffer = await stream.read_async(
                                buffer, size, InputStreamOptions.READ_AHEAD
                            )
                            reader = DataReader.from_buffer(filled_buffer)
                            raw = bytearray(filled_buffer.length)
                            reader.read_bytes(raw)
                            data_bytes = bytes(raw)
                            cover_diag["bytes_read"] = len(data_bytes) if data_bytes else 0
                            cover_diag["success"] = bool(data_bytes)
                except Exception as e:
                    cover_diag["error"] = f"{type(e).__name__} : {e}"
                result["cover_diagnostic"] = cover_diag
            else:
                result["current_session"] = None
        except Exception as e:
            result["current_session_error"] = f"get_current_session() a échoué : {e}"

        return result


# Instance unique partagée dans toute l'application
windows_media_service = WindowsMediaService()
