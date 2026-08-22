"""
Cockpit OS — Service CDP Deezer Player
Injecte window.dzPlayer.play() dans Deezer Desktop via Chrome DevTools Protocol.

Prérequis : Deezer Desktop lancé avec --remote-debugging-port=9222

Le payload envoyé à dzPlayer.play() dépend du CONTEXTE de sélection remonté
depuis l'UI :

  source == "search"    → track_mix (mix du morceau, aucun contexte)
  source == "playlist"  → playlist  (charge la playlist, démarre à `index`)
  source == "favorites" → playlist  (loved_tracks_id + index)
                          fallback  → type "favorite" (id=0) si le premier
                          payload échoue côté Deezer.
"""

import asyncio
import json
from typing import Any, Optional

import httpx

from core.logger import get_logger

logger = get_logger(__name__)

DEFAULT_CDP_PORT = 9222

# ── Templates JS injectés dans le renderer Deezer Desktop ──────────────

_PLAY_JS_FLOW = """
(async () => {
    if (typeof window.dzPlayer === 'undefined') {
        throw new Error("dzPlayer introuvable — page Deezer Desktop non chargée.");
    }
    await window.dzPlayer.play({
        type: "flow",
        id: 0,
        data: [],
        context: { ID: "", TYPE: "flow", CONTEXT_ID: "" },
        radio: true,
        autoplay: true
    });
    return "ok";
})()
""".strip()

_PLAY_JS_ALBUM = """
(async () => {{
    if (typeof window.dzPlayer === 'undefined') {{
        throw new Error("dzPlayer introuvable — page Deezer Desktop non chargée.");
    }}
    await window.dzPlayer.play({{
        type: "album",
        id: {album_id},
        data: [],
        index: {index},
        context: {{ ID: "{album_id}", TYPE: "album", CONTEXT_ID: "" }},
        radio: false,
        autoplay: true
    }});
    return "ok";
}})()
""".strip()

_PLAY_JS_TRACK_MIX = """
(async () => {{
    if (typeof window.dzPlayer === 'undefined') {{
        throw new Error("dzPlayer introuvable — page Deezer Desktop non chargée.");
    }}
    await window.dzPlayer.play({{
        type: "track_mix",
        id: {sng_id},
        data: [],
        forceAsFirstTrack: true,
        context: {{ ID: "", TYPE: "", CONTEXT_ID: "" }},
        radio: false,
        autoplay: true
    }});
    return "ok";
}})()
""".strip()

# Nouveau template dédié à la file personnalisée gérée par Cockpit (lecture isolée).
# Différence majeure avec _PLAY_JS_TRACK_MIX (qui génère une radio algorithmique) :
# - Le type "track" (singulier) est indispensable ici : c'est le type reconnu en interne par Deezer Desktop
#   pour récupérer directement les métadonnées d'un morceau unique sans lancer de radio/mix algorithmique.
# - id: [sng_id] (sous forme de tableau) et data: [] demandent à Deezer de charger UNIQUEMENT
#   ce morceau précis sans recommandations automatiques ou autoplay de morceaux tiers après.
# - L'absence de contexte empêche Deezer de continuer sur sa propre file de lecture, laissant
#   le contrôle d'enchaînement total à Cockpit via l'écouteur "media.state".
_PLAY_JS_TRACK_SINGLE = """
(async () => {{
    if (typeof window.dzPlayer === 'undefined') {{
        throw new Error("dzPlayer introuvable — page Deezer Desktop non chargée.");
    }}
    await window.dzPlayer.play({{
        type: "track",
        id: [{sng_id}],
        data: [],
        context: {{ ID: "", TYPE: "track", CONTEXT_ID: "" }},
        radio: false,
        autoplay: true
    }});
    return "ok";
}})()
""".strip()

# Nouveau template pour charger une liste de morceaux (file personnalisée Cockpit) dans la file d'attente native de Deezer.
# - Comme pour _PLAY_JS_TRACK_SINGLE, nous utilisons le type "track" (au singulier) pour éviter le mix algorithmique,
#   mais nous fournissons un tableau d'identifiants [sng_ids] et définissons l'index de départ à 0.
_PLAY_JS_TRACK_QUEUE = """
(async () => {{
    if (typeof window.dzPlayer === 'undefined') {{
        throw new Error("dzPlayer introuvable — page Deezer Desktop non chargée.");
    }}
    await window.dzPlayer.play({{
        type: "track",
        id: [{sng_ids}],
        data: [],
        index: 0,
        context: {{ ID: "", TYPE: "track", CONTEXT_ID: "" }},
        radio: false,
        autoplay: true
    }});
    return "ok";
}})()
""".strip()

_PLAY_JS_PLAYLIST = """
(async () => {{
    if (typeof window.dzPlayer === 'undefined') {{
        throw new Error("dzPlayer introuvable — page Deezer Desktop non chargée.");
    }}
    await window.dzPlayer.play({{
        type: "playlist",
        id: {playlist_id},
        data: [],
        index: {index},
        context: {{ ID: "{playlist_id}", TYPE: "playlist", CONTEXT_ID: "" }},
        radio: false,
        autoplay: true
    }});
    return "ok";
}})()
""".strip()

# Fallback pour les coups de cœur si loved_tracks_id n'est pas connu
_PLAY_JS_FAVORITE_FALLBACK = """
(async () => {
    if (typeof window.dzPlayer === 'undefined') {
        throw new Error("dzPlayer introuvable — page Deezer Desktop non chargée.");
    }
    await window.dzPlayer.play({
        type: "favorite",
        id: 0,
        data: [],
        context: { ID: "", TYPE: "favorite", CONTEXT_ID: "" },
        radio: false,
        autoplay: true
    });
    return "ok";
})()
""".strip()

# JS de lecture d'état renderer pour récupérer USER.LOVEDTRACKS_ID
_GET_LOVED_TRACKS_ID_JS = """
(() => {
    try {
        // Le state utilisateur est exposé sous plusieurs formes selon la version :
        //   window.USER, window.APP.state.user, window.dzPlayer.user, ...
        const candidates = [
            () => window.USER && window.USER.LOVEDTRACKS_ID,
            () => window.APP && window.APP.state && window.APP.state.user && window.APP.state.user.LOVEDTRACKS_ID,
            () => window.dzPlayer && window.dzPlayer.user && window.dzPlayer.user.LOVEDTRACKS_ID,
            () => window.__DZR_APP_STATE__ && window.__DZR_APP_STATE__.USER && window.__DZR_APP_STATE__.USER.LOVEDTRACKS_ID,
        ];
        for (const get of candidates) {
            try {
                const v = get();
                if (v) return String(v);
            } catch (e) { /* on continue */ }
        }
        return null;
    } catch (e) {
        return null;
    }
})()
""".strip()


class DeezerCDPPlayer:
    """Lance une piste précise dans Deezer Desktop via CDP."""

    def __init__(self, cdp_port: int = DEFAULT_CDP_PORT):
        self.cdp_port = cdp_port
        self._cdp_base = f"http://127.0.0.1:{cdp_port}"
        # Cache en mémoire du loved_tracks_id détecté via CDP
        self._loved_tracks_id_cache: Optional[str] = None
        # OPTIMISATION 1 : Connexion WebSocket CDP persistante et cache de la cible
        self._active_ws = None
        self._active_ws_url: Optional[str] = None
        # Boucle asyncio dans laquelle _active_ws a été créée. windows_media.py
        # exécute chaque commande dans une boucle neuve (asyncio.run() dans un
        # thread dédié) — un websocket créé dans une autre boucle ne peut pas y
        # être réutilisé (échoue sur send()/recv()). Suivre l'identité de la
        # boucle permet de forcer une reconnexion propre au lieu d'un échec.
        self._active_ws_loop_id: Optional[int] = None
        self._cached_target: Optional[dict] = None
        self._req_id: int = 0

    async def _close_ws(self) -> None:
        """Ferme proprement la connexion WebSocket CDP active."""
        if self._active_ws:
            try:
                await self._active_ws.close()
            except Exception:
                pass
        self._active_ws = None
        self._active_ws_url = None
        self._active_ws_loop_id = None

    def _drop_ws_from_foreign_loop(self) -> None:
        """
        Comme _close_ws, mais sans tenter de fermer proprement le socket : appelé
        quand la connexion appartient à une AUTRE boucle asyncio que l'actuelle,
        où l'attendre planterait. Le serveur CDP détectera la déconnexion de
        lui-même une fois le socket ramassé par le garbage collector.
        """
        self._active_ws = None
        self._active_ws_url = None
        self._active_ws_loop_id = None

    async def _get_ws(self, target: dict):
        """Réutilise la connexion WebSocket CDP ouverte (dans la même boucle) ou en crée une nouvelle."""
        ws_url = target.get("webSocketDebuggerUrl")
        if not ws_url:
            return None

        current_loop_id = id(asyncio.get_running_loop())

        if self._active_ws is not None:
            try:
                same_loop = self._active_ws_loop_id == current_loop_id
                if not self._active_ws.closed and self._active_ws_url == ws_url and same_loop:
                    return self._active_ws
            except Exception:
                same_loop = True  # inconnu → tenter une fermeture propre par défaut

            if same_loop:
                await self._close_ws()
            else:
                self._drop_ws_from_foreign_loop()

        try:
            import websockets  # type: ignore[import]
            self._active_ws = await websockets.connect(ws_url, open_timeout=5)
            self._active_ws_url = ws_url
            self._active_ws_loop_id = current_loop_id
            logger.info(f"✅ Connexion WebSocket CDP persistante établie ({ws_url})")
            return self._active_ws
        except Exception as e:
            logger.warning(f"Échec connexion WebSocket CDP persistante ({ws_url}) : {e}")
            await self._close_ws()
            return None

    # ══════════════════════════════════════════════════════════════════
    # Point d'entrée public
    # ══════════════════════════════════════════════════════════════════

    async def play_track(
        self,
        track_id: Any,
        title: str = "",
        source: str = "search",
        playlist_id: Any = None,
        album_id: Any = None,
        index: Optional[int] = None,
        loved_tracks_id: Any = None,
        queue_track_ids: Optional[list] = None,
        # Rétro-compat : anciens appels sans `source` mais avec `playlist_id`
        # continuent de fonctionner (source déduite).
    ) -> dict:
        """
        Args:
            track_id        : SNG_ID de la piste
            title           : titre (pour messages retour)
            source          : "search" | "playlist" | "album" | "favorites"
            playlist_id     : requis si source == "playlist"
            album_id        : requis si source == "album"
            index           : position 0-based du morceau dans la playlist / album / favoris
            loved_tracks_id : id de la playlist "loved tracks" (source == "favorites")

        Returns:
            dict WebSocket → "deezer.player.launched" | "deezer.player.error"
        """
        source = (source or "search").lower()
        if source == "flow":
            sng_id = 0
        else:
            if not track_id:
                return {"type": "deezer.player.error", "message": "ID de piste manquant"}

            try:
                sng_id = int(track_id)
            except (ValueError, TypeError):
                return {"type": "deezer.player.error",
                        "message": f"ID de piste invalide : {track_id!r}"}

        # Déduction de la source si non explicite
        if source == "search":
            if playlist_id:
                source = "playlist"
            elif album_id:
                source = "album"

        if source not in {"search", "playlist", "album", "favorites", "flow", "queue_isolated"}:
            logger.warning(f"source inconnue '{source}', repli sur 'search'")
            source = "search"

        # ── Étape 1/2 : cible CDP ────────────────────────────────────
        targets = await self._list_cdp_targets()
        if targets is None:
            return {"type": "deezer.player.error", "cdp_port": self.cdp_port,
                    "message": f"Port CDP {self.cdp_port} inaccessible. Lancez Deezer via le raccourci 'Deezer (Cockpit OS)' sur le Bureau."}
        target = self._find_deezer_target(targets)
        if not target:
            return {"type": "deezer.player.error",
                    "message": "Aucune fenêtre Deezer Desktop détectée."}

        logger.info(f"CDP play_track — source={source} SNG_ID={sng_id} "
                    f"playlist={playlist_id} album={album_id} index={index} « {title} »")

        # ── Étape 3 : payload selon source ────────────────────────────
        js_primary: str
        js_fallback: Optional[str] = None
        mode: str

        if source == "flow":
            js_primary = _PLAY_JS_FLOW
            mode = "flow"

        elif source == "playlist":
            try:
                pl_id = int(playlist_id) if playlist_id is not None else None
            except (ValueError, TypeError):
                pl_id = None
            if pl_id is None:
                logger.warning("source=playlist sans playlist_id — repli sur track_mix")
                js_primary = _PLAY_JS_TRACK_MIX.format(sng_id=sng_id)
                mode = "track_mix"
            else:
                idx = index if isinstance(index, int) and index >= 0 else await self._resolve_track_index(pl_id, sng_id)
                js_primary = _PLAY_JS_PLAYLIST.format(playlist_id=pl_id, index=idx)
                mode = "playlist"

        elif source == "album":
            try:
                alb_id = int(album_id) if album_id is not None else None
            except (ValueError, TypeError):
                alb_id = None
            if alb_id is None:
                logger.warning("source=album sans album_id — repli sur track_mix")
                js_primary = _PLAY_JS_TRACK_MIX.format(sng_id=sng_id)
                mode = "track_mix"
            else:
                idx = index if isinstance(index, int) and index >= 0 else await self._resolve_track_index_album(alb_id, sng_id)
                js_primary = _PLAY_JS_ALBUM.format(album_id=alb_id, index=idx)
                mode = "album"

        elif source == "favorites":
            # Résoudre loved_tracks_id : arg explicite > cache > lecture CDP
            lt_id: Optional[int] = None
            for candidate in (loved_tracks_id, self._loved_tracks_id_cache):
                if candidate:
                    try:
                        lt_id = int(candidate)
                        break
                    except (ValueError, TypeError):
                        pass
            if lt_id is None:
                fetched = await self._fetch_loved_tracks_id(target)
                if fetched:
                    self._loved_tracks_id_cache = fetched
                    try:
                        lt_id = int(fetched)
                    except (ValueError, TypeError):
                        lt_id = None

            if lt_id is not None:
                idx = index if isinstance(index, int) and index >= 0 else await self._resolve_track_index(lt_id, sng_id)
                js_primary = _PLAY_JS_PLAYLIST.format(playlist_id=lt_id, index=idx)
                js_fallback = _PLAY_JS_FAVORITE_FALLBACK
                mode = "favorites"
            else:
                logger.warning("loved_tracks_id introuvable via CDP — repli sur "
                               "payload type=favorite (id=0)")
                js_primary = _PLAY_JS_FAVORITE_FALLBACK
                mode = "favorite_fallback"

        elif source == "queue_isolated":
            if queue_track_ids:
                valid_ids = []
                for tid in queue_track_ids:
                    try:
                        valid_ids.append(int(tid))
                    except (ValueError, TypeError):
                        pass
                if valid_ids:
                    sng_ids_str = ", ".join(map(str, valid_ids))
                    js_primary = _PLAY_JS_TRACK_QUEUE.format(sng_ids=sng_ids_str)
                else:
                    js_primary = _PLAY_JS_TRACK_SINGLE.format(sng_id=sng_id)
            else:
                js_primary = _PLAY_JS_TRACK_SINGLE.format(sng_id=sng_id)
            mode = "queue_isolated"

        else:  # source == "search"
            js_primary = _PLAY_JS_TRACK_MIX.format(sng_id=sng_id)
            mode = "track_mix"

        # ── Étape 4 : injection JS ────────────────────────────────────
        ok, err = await self._cdp_eval(target, js_primary)
        if not ok and js_fallback:
            logger.warning(f"payload primaire échoué ({err}) — tentative fallback")
            ok, err = await self._cdp_eval(target, js_fallback)
            if ok:
                mode = "favorite_fallback"

        if ok:
            logger.info(f"✅ Piste lancée via CDP — source={source} mode={mode} SNG_ID={sng_id}")
            return {
                "type": "deezer.player.launched",
                "track_id": sng_id,
                "source": source,
                "playlist_id": playlist_id,
                "album_id": album_id,
                "title": title,
                "message": f"« {title} » lancé dans Deezer Desktop",
                "via": "cdp",
                "mode": mode,
            }

        logger.error(f"❌ Échec CDP — source={source} SNG_ID={sng_id} : {err}")
        return {"type": "deezer.player.error", "track_id": sng_id, "title": title,
                "message": err or "Erreur inconnue lors de l'injection CDP"}

    # ══════════════════════════════════════════════════════════════════
    # Résolution d'index dans une playlist (API publique Deezer)
    # ══════════════════════════════════════════════════════════════════

    async def _resolve_track_index(self, playlist_id: int, sng_id: int) -> int:
        url = f"https://api.deezer.com/playlist/{playlist_id}/tracks?limit=2000"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                payload = resp.json()
        except Exception as e:
            logger.warning(f"_resolve_track_index : playlist {playlist_id} : {e}")
            return 0

        tracks = payload.get("data", [])
        for i, track in enumerate(tracks):
            if track.get("id") == sng_id:
                return i

        logger.warning(f"_resolve_track_index : SNG_ID={sng_id} introuvable dans "
                       f"playlist {playlist_id} ({len(tracks)} pistes) — fallback 0")
        return 0

    # ══════════════════════════════════════════════════════════════════
    # Résolution d'index dans un album (API publique Deezer)
    # ══════════════════════════════════════════════════════════════════

    async def _resolve_track_index_album(self, album_id: int, sng_id: int) -> int:
        url = f"https://api.deezer.com/album/{album_id}/tracks?limit=2000"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                payload = resp.json()
        except Exception as e:
            logger.warning(f"_resolve_track_index_album : album {album_id} : {e}")
            return 0

        tracks = payload.get("data", [])
        for i, track in enumerate(tracks):
            if track.get("id") == sng_id:
                return i

        logger.warning(f"_resolve_track_index_album : SNG_ID={sng_id} introuvable dans "
                       f"album {album_id} ({len(tracks)} pistes) — fallback 0")
        return 0

    # ══════════════════════════════════════════════════════════════════
    # Récupération de USER.LOVEDTRACKS_ID via CDP
    # ══════════════════════════════════════════════════════════════════

    async def _fetch_loved_tracks_id(self, target: dict) -> Optional[str]:
        """Lit USER.LOVEDTRACKS_ID dans le renderer Deezer via CDP."""
        ws = await self._get_ws(target)
        if not ws:
            return None

        self._req_id += 1
        req_id = self._req_id
        payload = json.dumps({
            "id": req_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": _GET_LOVED_TRACKS_ID_JS,
                "returnByValue": True,
            },
        })
        try:
            await ws.send(payload)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                resp = json.loads(raw)
                if resp.get("id") == req_id:
                    break
            val = resp.get("result", {}).get("result", {}).get("value")
            if val:
                logger.info(f"loved_tracks_id détecté via CDP : {val}")
                return str(val)
        except Exception as e:
            logger.warning(f"_fetch_loved_tracks_id : erreur WebSocket CDP : {e}")
            await self._close_ws()
        return None

    # ══════════════════════════════════════════════════════════════════
    # Plomberie CDP (targets + eval)
    # ══════════════════════════════════════════════════════════════════

    async def _list_cdp_targets(self, force_refresh: bool = False) -> Optional[list]:
        """Retourne la liste des cibles CDP. Utilise la cible en cache si disponible sauf demande explicite."""
        if not force_refresh and self._cached_target:
            return [self._cached_target]

        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                r = await client.get(f"{self._cdp_base}/json")
                r.raise_for_status()
                targets = r.json()
                deezer_target = self._find_deezer_target(targets)
                if deezer_target:
                    self._cached_target = deezer_target
                return targets
        except Exception as e:
            logger.warning(f"Erreur liste targets CDP : {e}")
            self._cached_target = None
            return None

    @staticmethod
    def _find_deezer_target(targets: list) -> Optional[dict]:
        def _is_deezer_page(t: dict) -> bool:
            if t.get("type") != "page":
                return False
            url = t.get("url", "")
            return "deezer.com" in url or "deezer-desktop" in url

        candidates = [t for t in targets if _is_deezer_page(t)]
        if not candidates:
            return None

        def _priority(t: dict) -> int:
            url = t.get("url", "")
            if "index.html" in url:
                return 0
            if "titlebar" in url or "splash" in url:
                return 2
            return 1

        candidates.sort(key=_priority)
        return candidates[0]

    async def _cdp_eval(self, target: dict, js: str) -> tuple:
        """Exécute une expression JS via le WebSocket CDP réutilisable (ignore la valeur de retour)."""
        ok, _value, err = await self._cdp_eval_value(target, js)
        return ok, err

    async def _cdp_eval_value(self, target: dict, js: str) -> tuple:
        """Comme _cdp_eval, mais retourne aussi la valeur JS évaluée (returnByValue) : (succès, valeur, erreur)."""
        ws = await self._get_ws(target)
        if not ws:
            # En cas d'échec (ex: Deezer Desktop relancé), forcer la ré-interrogation des targets CDP
            self._cached_target = None
            targets = await self._list_cdp_targets(force_refresh=True)
            if targets:
                new_target = self._find_deezer_target(targets)
                if new_target:
                    target = new_target
                    ws = await self._get_ws(target)

        if not ws:
            return False, None, "Impossible d'établir la connexion WebSocket CDP persistante"

        self._req_id += 1
        req_id = self._req_id
        payload = json.dumps({
            "id": req_id,
            "method": "Runtime.evaluate",
            "params": {"expression": js, "awaitPromise": True, "returnByValue": True},
        })

        try:
            await ws.send(payload)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
                resp = json.loads(raw)
                if resp.get("id") == req_id:
                    break
        except asyncio.TimeoutError:
            return False, None, "Timeout : Deezer Desktop n'a pas répondu (10s)"
        except Exception as e:
            logger.warning(f"Erreur communication CDP ({e}), réinitialisation de la connexion persistante")
            await self._close_ws()
            self._cached_target = None
            return False, None, f"Erreur WebSocket CDP : {e}"

        exc = resp.get("result", {}).get("exceptionDetails")
        if exc:
            description = (exc.get("exception", {}).get("description")
                           or exc.get("text") or str(exc))
            return False, None, f"Erreur JS Deezer : {description}"
        value = resp.get("result", {}).get("result", {}).get("value")
        return True, value, None

    async def _get_target(self) -> Optional[dict]:
        targets = await self._list_cdp_targets()
        if not targets:
            return None
        return self._find_deezer_target(targets)

    # ══════════════════════════════════════════════════════════════════
    # État & contrôle direct (shuffle / repeat / lecture)
    #
    # Windows Media Session (SMTC) ne reflète pas le shuffle/repeat de Deezer
    # Desktop : changer l'un des deux via SMTC (try_change_shuffle_active_async,
    # try_change_auto_repeat_mode_async) n'a aucun effet, et l'état interne réel
    # de Deezer n'y remonte pas non plus (vérifié : activer le shuffle côté
    # Deezer ne change jamais ce que SMTC rapporte). dzPlayer expose ces deux
    # état/contrôles directement et fiablement, donc on passe par CDP pour Deezer
    # plutôt que par la session Windows Media.
    # ══════════════════════════════════════════════════════════════════

    async def get_player_state(self) -> Optional[dict]:
        """
        État de lecture réel de Deezer Desktop lu directement via dzPlayer (CDP).
        Retourne None si CDP est indisponible (Deezer non lancé avec le port de
        débogage distant) ou si la page Deezer n'est pas encore chargée.
        """
        target = await self._get_target()
        if not target:
            return None

        js = """
        (() => {
            if (typeof window.dzPlayer === 'undefined') return null;
            return {
                playing: !!window.dzPlayer.isPlaying(),
                shuffle: !!window.dzPlayer.isShuffle(),
                repeat: window.dzPlayer.getRepeat(),
                position: window.dzPlayer.getPosition(),
                duration: Number(window.dzPlayer.getDuration()) || 0,
            };
        })()
        """.strip()
        ok, value, _err = await self._cdp_eval_value(target, js)
        return value if (ok and value is not None) else None

    async def set_shuffle(self, enabled: bool) -> Optional[bool]:
        """Active/désactive le mode aléatoire dans Deezer. Retourne le nouvel état ou None si échec."""
        target = await self._get_target()
        if not target:
            return None
        js = f"""
        (() => {{
            if (typeof window.dzPlayer === 'undefined') return null;
            window.dzPlayer.control.setShuffle({'true' if enabled else 'false'});
            return !!window.dzPlayer.isShuffle();
        }})()
        """.strip()
        ok, value, _err = await self._cdp_eval_value(target, js)
        return value if ok else None

    async def cycle_repeat(self) -> Optional[int]:
        """
        Fait passer le mode répétition Deezer au suivant : none(0) → all(2) → track(1) → none(0)
        (même ordre que le cycle utilisé côté SMTC pour les autres lecteurs).
        Retourne le nouveau mode (0/1/2) ou None si échec.
        """
        target = await self._get_target()
        if not target:
            return None
        js = """
        (() => {
            if (typeof window.dzPlayer === 'undefined') return null;
            const current = window.dzPlayer.getRepeat();
            const next = ({0: 2, 2: 1, 1: 0})[current];
            const resolved = (next === undefined) ? 0 : next;
            window.dzPlayer.control.setRepeat(resolved);
            return window.dzPlayer.getRepeat();
        })()
        """.strip()
        ok, value, _err = await self._cdp_eval_value(target, js)
        return value if ok else None

    # ══════════════════════════════════════════════════════════════════
    # Diagnostic
    # ══════════════════════════════════════════════════════════════════

    async def get_diagnostic(self) -> dict:
        targets = await self._list_cdp_targets()
        if targets is None:
            return {"cdp_available": False, "cdp_port": self.cdp_port,
                    "deezer_target_found": False,
                    "error": f"Port {self.cdp_port} inaccessible"}
        deezer_target = self._find_deezer_target(targets)
        return {
            "cdp_available": True,
            "cdp_port": self.cdp_port,
            "total_targets": len(targets),
            "deezer_target_found": deezer_target is not None,
            "loved_tracks_id_cached": self._loved_tracks_id_cache,
            "deezer_target": {
                "url": deezer_target.get("url") if deezer_target else None,
                "title": deezer_target.get("title") if deezer_target else None,
                "type": deezer_target.get("type") if deezer_target else None,
            },
        }


deezer_player_service = DeezerCDPPlayer()
