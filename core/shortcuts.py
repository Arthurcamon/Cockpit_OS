"""
Cockpit OS — Endpoints Raccourcis (Shortcuts)
"""

import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging

logger = logging.getLogger("cockpit-os")

router = APIRouter(prefix="/shortcuts", tags=["Shortcuts"])

# --- Base de données statique / dynamique pour les raccourcis ---

MOCK_APPS = [
    {"id": "discord", "name": "Discord", "icon_class": "icon-discord", "category": "Communication"},
    {"id": "browser", "name": "Navigateur", "icon_class": "icon-browser", "category": "Web"},
    {"id": "explorer", "name": "Explorateur", "icon_class": "icon-folder", "category": "Système"},
    {"id": "spotify", "name": "Spotify", "icon_class": "icon-music", "category": "Média"},
    {"id": "simhub", "name": "SimHub", "icon_class": "icon-gauge", "category": "Sim-Racing"},
    {"id": "crewchief", "name": "Crew Chief", "icon_class": "icon-headset", "category": "Sim-Racing"},
]

MOCK_STEAM_GAMES = [
    {"app_id": "805550", "name": "Assetto Corsa Competizione", "icon_url": "/assets/games/acc.png"},
    {"app_id": "266410", "name": "iRacing", "icon_url": "/assets/games/iracing.png"},
    {"app_id": "2488620", "name": "F1 24", "icon_url": "/assets/games/f1.png"},
    {"app_id": "1068010", "name": "Automobilista 2", "icon_url": "/assets/games/ams2.png"},
    {"app_id": "365960", "name": "rFactor 2", "icon_url": "/assets/games/rf2.png"},
    {"app_id": "690790", "name": "DiRT Rally 2.0", "icon_url": "/assets/games/dirt.png"},
]

MOCK_WINDOWS = [
    {"hwnd": 1001, "title": "Assetto Corsa Competizione", "icon_url": "game"},
    {"hwnd": 1002, "title": "Discord — #salon-simracing", "icon_url": "chat"},
    {"hwnd": 1003, "title": "Google Chrome — Live Timing", "icon_url": "browser"},
    {"hwnd": 1004, "title": "SimHub — Cockpit Dash v2", "icon_url": "gauge"},
    {"hwnd": 1005, "title": "Spotify — Heavy Metal Workout", "icon_url": "music"},
]

MOCK_SCENES = [
    {"id": "race_mode", "name": "Mode Course", "description": "Lance SimHub + CrewChief + Profil Audio Casque", "icon": "flag"},
    {"id": "cinema_mode", "name": "Mode Cinéma", "description": "Mute Micro + Luminosité 30% + Fullscreen Media", "icon": "film"},
    {"id": "work_mode", "name": "Mode Travail", "description": "Ouvre VSCode + Navigateur + Musique calme", "icon": "briefcase"},
    {"id": "night_mode", "name": "Mode Nuit", "description": "Luminosité minimale + Limiteur volume 40%", "icon": "moon"},
]


@router.get("/apps")
async def get_apps():
    """Retourne la liste des applications rapides."""
    return MOCK_APPS


@router.post("/launch/{app_id}")
async def launch_app(app_id: str):
    """Lance une application rapide."""
    logger.info(f"[Shortcuts] Lancement application : {app_id}")
    await asyncio.sleep(0.3)  # Simulation légère de traitement
    return {"status": "ok", "app_id": app_id, "message": f"Application '{app_id}' lancée"}


@router.get("/steam-games")
async def get_steam_games():
    """Retourne la liste des jeux Steam installés."""
    return MOCK_STEAM_GAMES


@router.post("/steam/launch/{app_id}")
async def launch_steam_game(app_id: str):
    """Lance un jeu Steam via son AppID."""
    logger.info(f"[Shortcuts] Lancement jeu Steam AppID : {app_id}")
    await asyncio.sleep(0.4)
    return {"status": "ok", "app_id": app_id, "message": f"Jeu Steam '{app_id}' démarré"}


@router.post("/system/{action}")
async def system_action(action: str):
    """Exécute une action système (lock | sleep | restart | shutdown | logoff)."""
    valid_actions = ["lock", "sleep", "restart", "shutdown", "logoff"]
    if action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Action système invalide: {action}")
    
    logger.info(f"[Shortcuts] Action système demandée : {action}")
    await asyncio.sleep(0.5)
    return {"status": "ok", "action": action, "message": f"Action système '{action}' exécutée avec succès"}


import platform
import ctypes

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
    """Déclenche une scène / macro prédéfinie."""
    logger.info(f"[Shortcuts] Exécution de la scène : {scene_id}")
    # Simule l'enchaînement de plusieurs actions (1.5 sec)
    await asyncio.sleep(1.5)
    return {"status": "ok", "scene_id": scene_id, "message": f"Scène '{scene_id}' exécutée"}
