"""
Cockpit OS — Service Deezer API
Responsable UNIQUEMENT de l'accès aux données Deezer.
Ce service ne contrôle PAS la lecture.

Utilise l'API publique Deezer :
  https://api.deezer.com/

Architecture abstraite prévue pour l'ajout d'OAuth plus tard.
"""

import os
from typing import Optional, Any
import httpx

from config import settings
from core.logger import get_logger

logger = get_logger(__name__)


class DeezerAPIClient:
    """
    Client bas niveau pour l'API Deezer.
    Couche abstraite qui facilitera l'ajout d'OAuth ultérieurement.
    """

    def __init__(self, base_url: str):
        self.base_url = base_url

        # Résolution SSL — ordre de priorité :
        # 1. certifi (bundle de certificats indépendant de Windows)
        # 2. verify=False si la variable d'env COCKPIT_SSL_INSECURE=1 est définie
        # 3. verify=True (défaut sécurisé)
        ssl_verify: bool | str = True
        try:
            import certifi
            ssl_verify = certifi.where()
        except ImportError:
            if os.environ.get("COCKPIT_SSL_INSECURE", "").strip() == "1":
                logger.warning(
                    "⚠️  SSL non vérifié (COCKPIT_SSL_INSECURE=1). "
                    "Installez certifi pour une solution sécurisée : pip install certifi"
                )
                ssl_verify = False

        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=10.0,
            headers={"User-Agent": "CockpitOS/1.0"},
            verify=ssl_verify,
        )

    async def get(self, path: str, params: Optional[dict] = None) -> dict:
        """Effectue une requête GET et retourne le JSON décodé."""
        try:
            response = await self._client.get(path, params=params or {})
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException:
            logger.error(f"Timeout lors de la requête Deezer : {path}")
            return {"error": "timeout", "data": []}
        except httpx.HTTPStatusError as e:
            logger.error(f"Erreur HTTP Deezer {e.response.status_code} : {path}")
            return {"error": str(e), "data": []}
        except Exception as e:
            logger.error(f"Erreur inattendue Deezer : {e}")
            return {"error": str(e), "data": []}

    async def close(self):
        await self._client.aclose()

    # --- Méthode à surcharger pour OAuth ---
    def set_access_token(self, token: str):
        """
        Définit le token OAuth pour les requêtes authentifiées.
        Prévu pour une future intégration OAuth Deezer.
        """
        self._client.headers.update({"Authorization": f"Bearer {token}"})


class DeezerAPIService:
    """
    Service Deezer de haut niveau.
    Fournit des méthodes métier pour accéder aux données Deezer.
    """

    def __init__(self):
        self._client = DeezerAPIClient(settings.DEEZER_API_BASE)
        self._user_id = settings.DEEZER_USER_ID

    # ── Recherche ──────────────────────────────────────────────────────────────

    async def search(self, query: str, filter_type: str = "track") -> list[dict]:
        """
        Recherche dans le catalogue Deezer.

        Args:
            query: Texte de recherche
            filter_type: Type de résultat ('track', 'artist', 'album', 'playlist')

        Returns:
            Liste de résultats correspondants
        """
        if not query.strip():
            return []

        valid_types = {"track", "artist", "album", "playlist"}
        if filter_type not in valid_types:
            filter_type = "track"

        endpoint = f"/search/{filter_type}" if filter_type != "track" else "/search"
        data = await self._client.get(endpoint, params={"q": query, "limit": 30})

        items = data.get("data", [])
        logger.info(f"Recherche '{query}' [{filter_type}] : {len(items)} résultats")
        return items

    # ── Playlists ──────────────────────────────────────────────────────────────

    async def get_user_playlists(self) -> list[dict]:
        """
        Récupère les playlists publiques de l'utilisateur configuré.
        Chaque playlist est annotée avec `is_owner` = True si le créateur
        correspond à DEEZER_USER_ID (playlist personnelle et modifiable).
        Gère la pagination pour agréger toutes les playlists disponibles.
        """
        path = f"/user/{self._user_id}/playlists"
        playlists = []
        visited_paths = set()
        
        while path:
            if path in visited_paths:
                logger.warning(f"[Deezer API] Boucle infinie détectée pour le chemin '{path}'. Arrêt de la pagination.")
                break
            visited_paths.add(path)

            data = await self._client.get(path)
            if "error" in data:
                logger.error(f"Erreur lors de la récupération des playlists sur le chemin '{path}': {data['error']}")
                break
                
            page_data = data.get("data", [])
            next_url = data.get("next")
            logger.info(f"[Deezer API] get_user_playlists iteration: path={path!r}, page_size={len(page_data)}, next_url={next_url!r}")
            playlists.extend(page_data)
            
            # Deezer renvoie le lien complet vers la page suivante dans le champ "next"
            if next_url:
                # Nettoyer l'URL absolue pour n'avoir que le chemin relatif + query
                base_prefix = settings.DEEZER_API_BASE
                if next_url.startswith(base_prefix):
                    path = next_url[len(base_prefix):]
                else:
                    from urllib.parse import urlparse
                    parsed = urlparse(next_url)
                    path = parsed.path + ("?" + parsed.query if parsed.query else "")
            else:
                path = None

        # Dé-duplication de sécurité par ID de playlist
        dedup_dict = {}
        for pl in playlists:
            pl_id = pl.get("id")
            if pl_id is not None:
                dedup_dict[str(pl_id)] = pl
        playlists = list(dedup_dict.values())

        try:
            uid = int(self._user_id)
        except (TypeError, ValueError):
            uid = self._user_id
        for pl in playlists:
            creator_id = (pl.get("creator") or {}).get("id")
            pl["is_owner"] = (creator_id == uid) or (str(creator_id) == str(self._user_id))
            
            # --- OPTIMISATION : Pas de sous-requêtes lourdes pour éviter l'erreur 'Quota limit exceeded' (code 4) ---
            # Le champ 'time_mod' est le timestamp Unix de modification de la playlist (déjà fourni par Deezer).
            # On l'utilise directement pour remplir 'last_track_added_at', avec repli sur 'time_add' puis sur 0.
            pl["last_track_added_at"] = pl.get("time_mod") or pl.get("time_add") or 0

        logger.info(f"Playlists récupérées au total après dé-duplication : {len(playlists)}")
        return playlists

    async def get_playlist_tracks(self, playlist_id: Any, limit: int = 2000) -> tuple[list[dict], bool]:
        """
        Récupère les morceaux d'une playlist ainsi que le flag `is_owner`.

        L'endpoint `/playlist/{id}/tracks` fournit `time_add` (timestamp Unix
        de l'ajout du morceau à la playlist), utilisé pour trier côté UI.
        """
        if not playlist_id:
            return [], False

        # On récupère la playlist elle-même pour connaître le créateur,
        # puis la liste complète des tracks (avec time_add).
        pl_info = await self._client.get(f"/playlist/{playlist_id}")
        creator_id = (pl_info.get("creator") or {}).get("id") if isinstance(pl_info, dict) else None
        try:
            uid = int(self._user_id)
        except (TypeError, ValueError):
            uid = self._user_id
        is_owner = (creator_id == uid) or (str(creator_id) == str(self._user_id))

        data = await self._client.get(
            f"/playlist/{playlist_id}/tracks",
            params={"limit": limit},
        )
        tracks = data.get("data", [])
        
        # On logue les 5 premiers éléments pour analyser le time_add brut
        first_5 = tracks[:5]
        for idx, t in enumerate(first_5):
            logger.info(f"[Deezer API] Track {idx} dans playlist {playlist_id} : id={t.get('id')}, time_add={t.get('time_add')}")

        # On garantit la présence de time_add même si l'API l'omet.
        for t in tracks:
            if "time_add" not in t:
                t["time_add"] = None
        logger.info(f"Morceaux playlist {playlist_id} (limite {limit}) : {len(tracks)} pistes (owner={is_owner})")
        return tracks, is_owner

    # ── Artistes ──────────────────────────────────────────────────────────────

    async def get_artist(self, artist_id: Any) -> dict:
        """Récupère les informations d'un artiste."""
        if not artist_id:
            return {}
        return await self._client.get(f"/artist/{artist_id}")

    async def get_artist_albums(self, artist_id: Any) -> list[dict]:
        """Récupère les albums d'un artiste."""
        if not artist_id:
            return []
        data = await self._client.get(f"/artist/{artist_id}/albums")
        return data.get("data", [])

    async def get_artist_top_tracks(self, artist_id: Any, limit: int = 10) -> list[dict]:
        """Récupère les meilleures pistes d'un artiste."""
        if not artist_id:
            return []
        data = await self._client.get(
            f"/artist/{artist_id}/top",
            params={"limit": limit},
        )
        return data.get("data", [])

    # ── Albums ────────────────────────────────────────────────────────────────

    async def get_album(self, album_id: Any) -> dict:
        """Récupère les informations d'un album."""
        if not album_id:
            return {}
        return await self._client.get(f"/album/{album_id}")

    async def get_album_tracks(self, album_id: Any) -> list[dict]:
        """Récupère les pistes d'un album."""
        if not album_id:
            return []
        data = await self._client.get(f"/album/{album_id}/tracks")
        return data.get("data", [])

    # ── Morceaux ──────────────────────────────────────────────────────────────

    async def get_track(self, track_id: Any) -> dict:
        """Récupère les informations d'une piste (dont la pochette)."""
        if not track_id:
            return {}
        return await self._client.get(f"/track/{track_id}")


# Instance unique partagée dans toute l'application
deezer_api_service = DeezerAPIService()
