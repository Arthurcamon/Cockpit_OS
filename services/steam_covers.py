"""
Cockpit OS — Récupération de jaquettes de jeux via l'API Steam (non officielle)

Pour chaque entrée "type":"game" de shortcuts_config.json sans "cover_path",
cherche une correspondance par nom via l'API de recherche du Store Steam
(endpoint public non documenté, pas de clé requise), puis télécharge la
jaquette portrait (image "library capsule", 600x900) depuis le CDN Steam
dans assets/game_covers/.

Écriture dans le fichier : lecture-modification-écriture CIBLÉE sur le seul
champ "cover_path" de l'entrée concernée, relue depuis le disque juste avant
écriture — ne doit jamais écraser une modification concurrente d'un autre
champ (name/command/icon_path/order...) faite en parallèle par l'app
compagnon CustomTkinter, qui édite le même fichier pendant que main.py
tourne. Voir core/shortcuts.py::reload_shortcuts_config_if_changed pour le
pendant lecture (détection des changements faits par l'app compagnon).
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Optional

import httpx

from core.logger import get_logger

logger = get_logger(__name__)

CONFIG_PATH = Path(__file__).parent.parent / "shortcuts_config.json"
COVERS_DIR = Path(__file__).parent.parent / "assets" / "game_covers"

STORE_SEARCH_URL = "https://store.steampowered.com/api/storesearch/"
COVER_CDN_TEMPLATE = "https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"

# Résolution SSL — même ordre de priorité que services/deezer_api.py :
# 1. certifi (bundle de certificats indépendant de Windows)
# 2. verify=False si COCKPIT_SSL_INSECURE=1 est définie
# 3. verify=True (défaut sécurisé)
_SSL_VERIFY: bool | str = True
try:
    import certifi
    _SSL_VERIFY = certifi.where()
except ImportError:
    if os.environ.get("COCKPIT_SSL_INSECURE", "").strip() == "1":
        logger.warning(
            "⚠️  SSL non vérifié pour la recherche de jaquettes Steam (COCKPIT_SSL_INSECURE=1). "
            "Installez certifi pour une solution sécurisée : pip install certifi"
        )
        _SSL_VERIFY = False

# (id, name) déjà tentés durant cette exécution du serveur — une seule
# recherche Steam par nom unique, pour ne pas marteler l'API à chaque
# passage de la tâche de fond quand un jeu n'a aucune correspondance.
# Un renommage change la clé et redéclenche donc naturellement un essai ;
# un redémarrage du serveur aussi (mémoire en RAM uniquement).
_attempted: set[tuple[str, str]] = set()


async def _search_appid(name: str) -> Optional[int]:
    """Cherche `name` dans le Store Steam, retourne l'AppID du premier
    résultat ou None (aucune correspondance ou erreur réseau — les deux
    cas sont traités pareil par l'appelant : jaquette non trouvée)."""
    try:
        async with httpx.AsyncClient(timeout=6.0, verify=_SSL_VERIFY) as client:
            resp = await client.get(
                STORE_SEARCH_URL,
                params={"term": name, "cc": "us", "l": "en"},
                headers={"User-Agent": "CockpitOS/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.info(f"[SteamCovers] Recherche Steam indisponible pour '{name}' : {e}")
        return None

    items = data.get("items") or []
    if not items:
        return None
    return items[0].get("id")


async def _download_cover(appid: int, dest: Path) -> bool:
    """Télécharge la jaquette portrait de `appid` vers `dest`. Retourne
    False (sans lever) si le jeu n'a pas cette image (certains jeux/appids
    n'ont pas de library_600x900.jpg) ou en cas d'erreur réseau."""
    url = COVER_CDN_TEMPLATE.format(appid=appid)
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=_SSL_VERIFY, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "CockpitOS/1.0"})
            if resp.status_code != 200 or not resp.content:
                return False
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(resp.content)
            return True
    except Exception as e:
        logger.info(f"[SteamCovers] Téléchargement de jaquette échoué (appid={appid}) : {e}")
        return False


def _write_cover_path_sync(app_id: str, cover_path: Optional[str]) -> None:
    """Bloquant (I/O disque) — à appeler via asyncio.to_thread. Ne modifie
    QUE "cover_path" de l'entrée `app_id`, relit le fichier juste avant
    d'écrire (voir docstring du module) et écrit via un fichier temporaire
    + remplacement atomique (os.replace) pour ne jamais laisser
    shortcuts_config.json à moitié écrit si le processus est interrompu."""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.error(f"[SteamCovers] Impossible de relire {CONFIG_PATH} pour mettre à jour la jaquette : {e}")
        return

    found = False
    for app in data.get("apps", []):
        if app.get("id") == app_id:
            app["cover_path"] = cover_path
            found = True
            break

    if not found:
        logger.debug(f"[SteamCovers] Entrée '{app_id}' disparue de la config — jaquette non enregistrée")
        return

    tmp_path = CONFIG_PATH.with_suffix(".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, CONFIG_PATH)
    except OSError as e:
        logger.error(f"[SteamCovers] Échec d'écriture de {CONFIG_PATH} : {e}")


async def fetch_missing_covers(games: list[dict]) -> None:
    """
    `games` : entrées "type":"game" actuellement sans cover_path (voir
    core/shortcuts.py::get_games_missing_cover, appelant depuis
    core/app.py). Traite chaque jeu l'un après l'autre (pas de parallélisme
    volontaire — ce n'est pas du temps réel, inutile de multiplier les
    requêtes simultanées vers Steam).
    """
    for game in games:
        app_id = game.get("id")
        name = game.get("name") or ""
        key = (app_id, name)
        if not app_id or not name or key in _attempted:
            continue
        _attempted.add(key)

        appid = await _search_appid(name)
        if appid is None:
            logger.info(f"[SteamCovers] Aucune correspondance Steam pour '{name}' ({app_id}) — dégradé de substitution conservé côté tablette")
            continue

        dest = COVERS_DIR / f"{app_id}.jpg"
        ok = await _download_cover(appid, dest)
        if not ok:
            logger.info(f"[SteamCovers] Pas de jaquette portrait disponible pour '{name}' (appid={appid})")
            continue

        cover_path = f"/assets/game_covers/{app_id}.jpg"
        await asyncio.to_thread(_write_cover_path_sync, app_id, cover_path)
        logger.info(f"[SteamCovers] Jaquette trouvée pour '{name}' (appid={appid}) -> {cover_path}")
