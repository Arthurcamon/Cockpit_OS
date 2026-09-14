"""
Cockpit OS — Endpoints Raccourcis (Shortcuts)
"""

import asyncio
import ctypes
import json
import os
import platform
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from config import settings
from core.logger import get_logger

logger = get_logger(__name__)

# Sans ce flag, chaque subprocess.Popen/run ci-dessous ouvre sa PROPRE
# fenêtre console visible (brièvement) dès que le process Python appelant
# n'a lui-même aucune console — le cas depuis que l'app compagnon lance
# main.py avec CREATE_NO_WINDOW (companion_app/server_control.py).
_IS_WINDOWS = platform.system() == "Windows"
_CREATE_NO_WINDOW = subprocess.CREATE_NO_WINDOW if _IS_WINDOWS else 0


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


# ── Configuration des raccourcis (apps / jeux) ───────────────────────────────
# Chargée depuis shortcuts_config.json (racine du projet), éditable sans
# toucher au code. Voir ce fichier pour le format attendu.

CONFIG_PATH = Path(__file__).parent.parent / "shortcuts_config.json"


def _normalize_app_entry(entry: dict, index: int) -> dict:
    """
    Comble les nouveaux champs (type/icon_path/order, voir Note/ pour le
    schéma) s'ils manquent dans une entrée éditée à la main ou provenant
    d'une config antérieure à leur introduction — rétro-compatibilité :
    absence de "type" == "app", absence d'"order" == position dans le
    fichier. Ne modifie jamais le fichier lui-même, uniquement la valeur
    servie en mémoire/API.
    """
    entry.setdefault("type", "app")
    entry.setdefault("icon_path", None)
    entry.setdefault("order", index)
    if entry["type"] == "game":
        entry.setdefault("cover_path", None)
    return entry


def _normalize_macro_entry(entry: dict, index: int) -> dict:
    entry.setdefault("icon_path", None)
    entry.setdefault("order", index)
    entry.setdefault("steps", [])
    return entry


def _load_shortcuts_config() -> dict:
    if not CONFIG_PATH.exists():
        logger.warning(f"[Shortcuts] Fichier de config introuvable : {CONFIG_PATH} — apps/macros vides")
        return {"apps": [], "macros": []}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        apps = [_normalize_app_entry(a, i) for i, a in enumerate(data.get("apps", []))]
        macros = [_normalize_macro_entry(m, i) for i, m in enumerate(data.get("macros", []))]
        return {"apps": apps, "macros": macros}
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"[Shortcuts] Erreur de lecture de {CONFIG_PATH} : {e} — apps/macros vides")
        return {"apps": [], "macros": []}


_SHORTCUTS_CONFIG = _load_shortcuts_config()

# Horodatage de dernière lecture (mtime disque) — sert à détecter que le
# fichier a changé sous nos pieds (édition manuelle, ou l'app compagnon
# CustomTkinter qui écrit dans ce même fichier pendant que main.py tourne)
# sans avoir à le relire à chaque requête API. Voir
# reload_shortcuts_config_if_changed, appelée périodiquement par une tâche
# de fond (core/app.py) plutôt qu'à la demande.
try:
    _config_mtime: float | None = CONFIG_PATH.stat().st_mtime
except OSError:
    _config_mtime = None


def reload_shortcuts_config_if_changed() -> bool:
    """
    Recharge _SHORTCUTS_CONFIG depuis le disque si shortcuts_config.json a
    changé depuis la dernière lecture connue (mtime). Retourne True si un
    rechargement a eu lieu. Sans ce mécanisme, une app/un jeu/une macro
    ajouté(e) par l'app compagnon pendant que le serveur tourne resterait
    invisible pour la tablette jusqu'au prochain redémarrage.
    """
    global _SHORTCUTS_CONFIG, _config_mtime
    try:
        current_mtime = CONFIG_PATH.stat().st_mtime
    except OSError:
        return False

    if _config_mtime is not None and current_mtime == _config_mtime:
        return False

    _config_mtime = current_mtime
    _SHORTCUTS_CONFIG = _load_shortcuts_config()
    logger.info("[Shortcuts] shortcuts_config.json rechargé (changement détecté)")
    return True


def get_games_missing_cover() -> list[dict]:
    """Entrées "type":"game" sans cover_path — utilisé par la tâche de
    fond de récupération de jaquettes (core/app.py + services/steam_covers.py)."""
    return [a for a in _SHORTCUTS_CONFIG["apps"] if a.get("type") == "game" and not a.get("cover_path")]


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


async def _launch_app_by_id(app_id: str) -> dict:
    """
    Logique de lancement partagée entre l'endpoint /launch/{app_id} (Apps
    rapides ET Jeux, mêmes entrées "apps" depuis le schéma étendu — un jeu
    n'a rien de spécial ici, il utilise "command" comme une app) et
    l'exécution d'une étape "launch_app" de macro (_run_macro_step).
    Lève HTTPException en cas d'échec — chaque appelant décide comment
    réagir (propager telle quelle pour l'endpoint direct, ou l'attraper
    pour ne pas interrompre le reste d'une macro).
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
        subprocess.Popen(command, shell=True, creationflags=_CREATE_NO_WINDOW)
    except OSError as e:
        logger.error(f"[Shortcuts] Échec lancement '{app_id}' ({command!r}) : {e}")
        raise HTTPException(status_code=500, detail=f"Échec du lancement de '{name}' : {e}")

    return {"status": "ok", "app_id": app_id, "action": "launched", "message": f"Application '{name}' lancée"}


@router.post("/launch/{app_id}")
async def launch_app(app_id: str):
    """
    Lance une application (ou un jeu — même schéma "apps", voir
    _normalize_app_entry) via la commande configurée dans
    shortcuts_config.json. Si déjà ouverte (détectée via `process_names`),
    sa fenêtre est mise au premier plan à la place — pas de nouvelle instance.
    """
    return await _launch_app_by_id(app_id)


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
        subprocess.run(["shutdown", "/r", "/t", "10"], check=True, creationflags=_CREATE_NO_WINDOW)

    elif action == "shutdown":
        subprocess.run(["shutdown", "/s", "/t", "10"], check=True, creationflags=_CREATE_NO_WINDOW)


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
    """Retourne la liste des macros configurées (shortcuts_config.json::macros)."""
    return _SHORTCUTS_CONFIG["macros"]


async def _run_macro_step(step: dict) -> None:
    """
    Exécute une étape de macro. Deux types supportés pour l'instant (schéma
    validé — voir Note/) : "launch_app" (référence un id de la liste "apps",
    même mécanisme que le lancement direct) et "wait" (pause en secondes).
    Une étape "launch_app" qui échoue (app inconnue, commande manquante) est
    loggée mais N'INTERROMPT PAS le reste de la macro — les étapes suivantes
    s'exécutent quand même, cohérent avec l'esprit "best effort" d'une
    séquence d'actions plutôt qu'une transaction tout-ou-rien.
    """
    step_type = step.get("type")
    if step_type == "launch_app":
        app_id = step.get("app_id")
        try:
            await _launch_app_by_id(app_id)
        except HTTPException as e:
            logger.warning(f"[Shortcuts] Étape de macro 'launch_app' ({app_id}) échouée : {e.detail}")
    elif step_type == "wait":
        seconds = step.get("seconds") or 0
        await asyncio.sleep(seconds)
    else:
        logger.warning(f"[Shortcuts] Type d'étape de macro inconnu, ignoré : {step_type!r}")


@router.post("/scenes/{scene_id}/run")
async def run_scene(scene_id: str):
    """Exécute réellement les étapes de la macro (voir _run_macro_step)."""
    macro = next((m for m in _SHORTCUTS_CONFIG["macros"] if m.get("id") == scene_id), None)
    if macro is None:
        raise HTTPException(status_code=404, detail=f"Macro inconnue : {scene_id}")

    logger.info(f"[Shortcuts] Exécution de la macro : {scene_id} ({len(macro.get('steps', []))} étape(s))")
    for step in macro.get("steps", []):
        await _run_macro_step(step)

    return {"status": "ok", "scene_id": scene_id, "message": f"Macro '{macro.get('name', scene_id)}' exécutée"}
