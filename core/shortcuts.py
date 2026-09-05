"""
Cockpit OS — Endpoints Raccourcis (Shortcuts)
"""

import asyncio
import ctypes
import json
import os
import platform
import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from config import settings
from core.logger import get_logger

logger = get_logger(__name__)


# ── Authentification ──────────────────────────────────────────────────────
# Toutes les routes de ce router exigent le token d'accès (settings.AUTH_TOKEN),
# passé soit via l'en-tête "Authorization: Bearer <token>" (utilisé par le
# frontend), soit via ?token= (repli pratique pour un test manuel/curl).

async def verify_token(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
) -> None:
    provided = None
    if authorization and authorization.lower().startswith("bearer "):
        provided = authorization[7:]
    elif token:
        provided = token

    if provided != settings.AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Token d'authentification invalide ou manquant")


router = APIRouter(prefix="/shortcuts", tags=["Shortcuts"], dependencies=[Depends(verify_token)])


# ── Configuration des raccourcis (apps / jeux Steam) ────────────────────────
# Chargée depuis shortcuts_config.json (racine du projet), éditable sans
# toucher au code. Voir ce fichier pour le format attendu.

CONFIG_PATH = Path(__file__).parent.parent / "shortcuts_config.json"


def _load_shortcuts_config() -> dict:
    if not CONFIG_PATH.exists():
        logger.warning(f"[Shortcuts] Fichier de config introuvable : {CONFIG_PATH} — apps vides")
        return {"apps": []}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return {"apps": data.get("apps", [])}
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"[Shortcuts] Erreur de lecture de {CONFIG_PATH} : {e} — apps vides")
        return {"apps": []}


_SHORTCUTS_CONFIG = _load_shortcuts_config()

# --- Scènes : encore simulées (nécessite un format de séquence d'actions, chantier à part) ---

MOCK_SCENES = [
    {"id": "race_mode", "name": "Mode Course", "description": "Lance SimHub + CrewChief + Profil Audio Casque", "icon": "flag"},
    {"id": "cinema_mode", "name": "Mode Cinéma", "description": "Mute Micro + Luminosité 30% + Fullscreen Media", "icon": "film"},
    {"id": "work_mode", "name": "Mode Travail", "description": "Ouvre VSCode + Navigateur + Musique calme", "icon": "briefcase"},
    {"id": "night_mode", "name": "Mode Nuit", "description": "Luminosité minimale + Limiteur volume 40%", "icon": "moon"},
]

# --- Jeux Steam : détectés en direct depuis les raccourcis .url que Steam
#     crée automatiquement dans le menu Démarrer (un par jeu installé), donc
#     toujours à jour sans liste à maintenir à la main. Repli simulé sur
#     non-Windows uniquement. ---

STEAM_SHORTCUTS_DIR = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Steam"
_STEAM_RUNGAMEID_RE = re.compile(r"steam://rungameid/(\d+)", re.IGNORECASE)

MOCK_STEAM_GAMES = [
    {"app_id": "805550", "name": "Assetto Corsa Competizione"},
    {"app_id": "266410", "name": "iRacing"},
]


def _discover_steam_games() -> list[dict]:
    """Scanne STEAM_SHORTCUTS_DIR et retourne un jeu par raccourci .url valide."""
    if not STEAM_SHORTCUTS_DIR.exists():
        logger.debug(f"[Shortcuts] Dossier raccourcis Steam introuvable : {STEAM_SHORTCUTS_DIR}")
        return []

    games = []
    for url_file in STEAM_SHORTCUTS_DIR.glob("*.url"):
        try:
            content = url_file.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            logger.debug(f"[Shortcuts] Lecture impossible de {url_file.name} : {e}")
            continue
        match = _STEAM_RUNGAMEID_RE.search(content)
        if not match:
            continue
        games.append({"app_id": match.group(1), "name": url_file.stem})

    games.sort(key=lambda g: g["name"].lower())
    return games


# --- Fenêtres ouvertes : repli si l'énumération Win32 échoue ---

MOCK_WINDOWS = [
    {"hwnd": 1001, "title": "Assetto Corsa Competizione", "icon_url": "game"},
    {"hwnd": 1002, "title": "Discord — #salon-simracing", "icon_url": "chat"},
    {"hwnd": 1003, "title": "Google Chrome — Live Timing", "icon_url": "browser"},
    {"hwnd": 1004, "title": "SimHub — Cockpit Dash v2", "icon_url": "gauge"},
    {"hwnd": 1005, "title": "Spotify — Heavy Metal Workout", "icon_url": "music"},
]


@router.get("/apps")
async def get_apps():
    """Retourne la liste des applications rapides (depuis shortcuts_config.json)."""
    return _SHORTCUTS_CONFIG["apps"]


@router.get("/apps/status")
async def get_apps_status():
    """
    Retourne, pour chaque app configurée, si elle est actuellement ouverte
    (même détection Win32 que /launch — voir _find_window_for_process_names).
    Utilisé par le client pour afficher un indicateur "déjà lancée" sur les
    tuiles Apps rapides.
    """
    if platform.system() != "Windows":
        return {app["id"]: False for app in _SHORTCUTS_CONFIG["apps"]}

    return {
        app["id"]: _find_window_for_process_names(app.get("process_names") or []) is not None
        for app in _SHORTCUTS_CONFIG["apps"]
    }


# ── Détection "app déjà ouverte" (focus au lieu de relancer) ────────────────

def _get_process_name_for_pid(pid: int) -> str | None:
    """Retourne le nom de l'exécutable (ex: 'Discord.exe') propriétaire du PID, ou None."""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h_process = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h_process:
        return None
    try:
        buf = ctypes.create_unicode_buffer(260)
        size = ctypes.c_ulong(260)
        ok = ctypes.windll.kernel32.QueryFullProcessImageNameW(h_process, 0, buf, ctypes.byref(size))
        if not ok:
            return None
        return os.path.basename(buf.value)
    finally:
        ctypes.windll.kernel32.CloseHandle(h_process)


def _find_window_for_process_names(process_names: list[str]) -> int | None:
    """
    Cherche la première fenêtre visible et titrée appartenant à l'un des noms
    de process donnés (insensible à la casse). Retourne son hwnd, ou None si
    aucune fenêtre correspondante n'est actuellement ouverte.
    EnumWindows énumère dans l'ordre Z (premier plan en premier), donc le
    premier match est déjà la fenêtre la plus "au-dessus" parmi les candidates.
    """
    targets = {p.lower() for p in process_names}
    if not targets:
        return None

    user32 = ctypes.windll.user32
    result: dict = {"hwnd": None}

    def enum_windows_callback(hwnd, extra):
        if not user32.IsWindowVisible(hwnd):
            return True
        if user32.GetWindowTextLengthW(hwnd) == 0:
            return True
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        pname = _get_process_name_for_pid(pid.value)
        if pname and pname.lower() in targets:
            result["hwnd"] = hwnd
            return False  # trouvé — arrête l'énumération
        return True

    try:
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
    except Exception as e:
        logger.debug(f"[Shortcuts] _find_window_for_process_names a échoué : {e}")
        return None

    return result["hwnd"]


@router.post("/launch/{app_id}")
async def launch_app(app_id: str):
    """
    Lance une application rapide via la commande configurée dans shortcuts_config.json.
    Si l'app est déjà ouverte (détectée via `process_names`), sa fenêtre est mise
    au premier plan à la place — pas de nouvelle instance.
    """
    app = next((a for a in _SHORTCUTS_CONFIG["apps"] if a.get("id") == app_id), None)
    if app is None:
        raise HTTPException(status_code=404, detail=f"Application inconnue : {app_id}")

    name = app.get("name", app_id)

    if platform.system() == "Windows":
        hwnd = _find_window_for_process_names(app.get("process_names") or [])
        if hwnd:
            focus_real_window(hwnd)
            logger.info(f"[Shortcuts] '{app_id}' déjà ouvert (hwnd={hwnd}) — mis au premier plan")
            return {"status": "ok", "app_id": app_id, "action": "focused", "message": f"'{name}' déjà ouvert — mis au premier plan"}

    command = app.get("command")
    if not command:
        raise HTTPException(
            status_code=400,
            detail=f"Commande non configurée pour '{name}' — édite shortcuts_config.json",
        )

    logger.info(f"[Shortcuts] Lancement application : {app_id} -> {command!r}")

    if platform.system() != "Windows":
        await asyncio.sleep(0.2)
        return {"status": "ok", "app_id": app_id, "action": "launched", "message": f"(simulation non-Windows) '{name}' lancée"}

    try:
        subprocess.Popen(command, shell=True)
    except OSError as e:
        logger.error(f"[Shortcuts] Échec lancement '{app_id}' ({command!r}) : {e}")
        raise HTTPException(status_code=500, detail=f"Échec du lancement de '{name}' : {e}")

    return {"status": "ok", "app_id": app_id, "action": "launched", "message": f"Application '{name}' lancée"}


@router.get("/steam-games")
async def get_steam_games():
    """Retourne la liste des jeux Steam actuellement installés (détectés en direct)."""
    if platform.system() != "Windows":
        return MOCK_STEAM_GAMES
    return _discover_steam_games()


@router.post("/steam/launch/{app_id}")
async def launch_steam_game(app_id: str):
    """Lance un jeu Steam via son AppID (protocole steam://rungameid/)."""
    if platform.system() != "Windows":
        await asyncio.sleep(0.2)
        return {"status": "ok", "app_id": app_id, "message": f"(simulation non-Windows) Jeu Steam '{app_id}' démarré"}

    game = next((g for g in _discover_steam_games() if g["app_id"] == app_id), None)
    if game is None:
        raise HTTPException(status_code=404, detail=f"Jeu Steam inconnu ou non installé : {app_id}")

    logger.info(f"[Shortcuts] Lancement jeu Steam AppID : {app_id} ({game['name']})")

    try:
        os.startfile(f"steam://rungameid/{app_id}")
    except OSError as e:
        logger.error(f"[Shortcuts] Échec lancement jeu Steam {app_id} : {e}")
        raise HTTPException(status_code=500, detail=f"Échec du lancement du jeu Steam '{game['name']}' : {e} (Steam est-il installé ?)")

    return {"status": "ok", "app_id": app_id, "message": f"Jeu Steam '{game['name']}' démarré"}


# --- Actions système ---

_VALID_SYSTEM_ACTIONS = ["lock", "sleep", "restart", "shutdown", "logoff"]


def _run_system_action_sync(action: str) -> None:
    """Exécute l'action système réelle. Lève une exception si l'appel échoue."""
    if action == "lock":
        if not ctypes.windll.user32.LockWorkStation():
            raise OSError("LockWorkStation() a échoué")

    elif action == "sleep":
        if not ctypes.windll.powrprof.SetSuspendState(False, True, False):
            raise OSError("SetSuspendState() a échoué")

    elif action == "logoff":
        if not ctypes.windll.user32.ExitWindowsEx(0, 0):
            raise OSError("ExitWindowsEx(EWX_LOGOFF) a échoué")

    elif action == "restart":
        subprocess.run(["shutdown", "/r", "/t", "10"], check=True)

    elif action == "shutdown":
        subprocess.run(["shutdown", "/s", "/t", "10"], check=True)


@router.post("/system/{action}")
async def system_action(action: str):
    """Exécute une action système réelle (lock | sleep | restart | shutdown | logoff)."""
    if action not in _VALID_SYSTEM_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Action système invalide: {action}")

    logger.info(f"[Shortcuts] Action système demandée : {action}")

    if platform.system() != "Windows":
        await asyncio.sleep(0.3)
        return {"status": "ok", "action": action, "message": f"(simulation non-Windows) Action '{action}' exécutée"}

    try:
        await asyncio.to_thread(_run_system_action_sync, action)
    except (OSError, subprocess.CalledProcessError) as e:
        logger.error(f"[Shortcuts] Échec action système '{action}' : {e}")
        raise HTTPException(status_code=500, detail=f"Échec de l'action système '{action}' : {e}")

    delay_note = " (dans 10s)" if action in ("restart", "shutdown") else ""
    return {"status": "ok", "action": action, "message": f"Action système '{action}' exécutée avec succès{delay_note}"}


def get_real_windows():
    if platform.system() != "Windows":
        return MOCK_WINDOWS

    windows = []
    try:
        user32 = ctypes.windll.user32

        def enum_windows_callback(hwnd, extra):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value.strip()
                    ignored = ["Program Manager", "Settings", "Microsoft Text Input Application", "Cortana", "NVIDIA GeForce Overlay"]
                    if title and title not in ignored and not title.startswith("Default IME"):
                        windows.append({
                            "hwnd": int(hwnd),
                            "title": title,
                            "icon_url": "window"
                        })
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
    except Exception as e:
        logger.error(f"Erreur lors de l'énumération des fenêtres Windows : {e}")
        return MOCK_WINDOWS

    return windows if windows else MOCK_WINDOWS


def focus_real_window(hwnd: int):
    if platform.system() == "Windows":
        try:
            user32 = ctypes.windll.user32
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE (9)
            user32.SetForegroundWindow(hwnd)
        except Exception as e:
            logger.error(f"Erreur focus fenêtre Windows HWND {hwnd} : {e}")


@router.get("/windows")
async def get_open_windows():
    """Retourne la liste des fenêtres actuellement ouvertes sur le PC."""
    return get_real_windows()


@router.post("/windows/focus/{hwnd}")
async def focus_window(hwnd: int):
    """Met la fenêtre spécifiée au premier plan."""
    logger.info(f"[Shortcuts] Mise au premier plan fenêtre HWND : {hwnd}")
    focus_real_window(hwnd)
    return {"status": "ok", "hwnd": hwnd, "message": f"Fenêtre {hwnd} au premier plan"}


@router.get("/scenes")
async def get_scenes():
    """Retourne la liste des macros / scènes disponibles."""
    return MOCK_SCENES


@router.post("/shortcuts/scenes/{scene_id}/run")
@router.post("/scenes/{scene_id}/run")
async def run_scene(scene_id: str):
    """Déclenche une scène / macro prédéfinie. Encore simulé — voir MOCK_SCENES ci-dessus."""
    logger.info(f"[Shortcuts] Exécution de la scène : {scene_id}")
    # Simule l'enchaînement de plusieurs actions (1.5 sec)
    await asyncio.sleep(1.5)
    return {"status": "ok", "scene_id": scene_id, "message": f"Scène '{scene_id}' exécutée"}
