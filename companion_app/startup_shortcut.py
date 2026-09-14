"""
Cockpit OS — App compagnon : raccourci "Lancer au démarrage de Windows".

Un .lnk dans shell:startup (dossier Démarrage du menu Démarrer de
l'utilisateur courant) — PAS de clé de registre Run, comme demandé dans le
plan (plus facile à retirer/inspecter à la main pour l'utilisateur qu'une
entrée de registre). Le raccourci lance l'app COMPAGNON elle-même (pas
main.py directement) via pythonw.exe pour ne montrer aucune fenêtre
console au démarrage de Windows — cohérent avec le comportement system
tray de l'étape 11 (l'app compagnon devient le superviseur qui tourne en
arrière-plan ; le serveur, lui, se lance depuis l'onglet Serveur, pas
automatiquement avec Windows sauf action explicite de l'utilisateur).
"""

import os
import sys
from pathlib import Path

import win32com.client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
COMPANION_MAIN = PROJECT_ROOT / "companion_app" / "main.py"

STARTUP_DIR = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
SHORTCUT_PATH = STARTUP_DIR / "Cockpit OS Compagnon.lnk"


def _pythonw_path() -> str:
    """pythonw.exe à côté de l'interpréteur courant (même venv/installation)
    — variante sans console de python.exe, toujours présente sur une
    installation Windows standard de CPython. Repli sur sys.executable
    (python.exe, montrerait une brève fenêtre console) si absente pour une
    raison quelconque, plutôt que d'échouer."""
    candidate = Path(sys.executable).with_name("pythonw.exe")
    return str(candidate) if candidate.exists() else sys.executable


def is_enabled() -> bool:
    return SHORTCUT_PATH.exists()


def enable() -> None:
    """Crée (ou remplace) le raccourci. Lève OSError/com_error en cas
    d'échec — à l'appelant (UI) de l'afficher clairement plutôt que
    d'échouer silencieusement."""
    STARTUP_DIR.mkdir(parents=True, exist_ok=True)
    shell = win32com.client.Dispatch("WScript.Shell")
    shortcut = shell.CreateShortCut(str(SHORTCUT_PATH))
    shortcut.TargetPath = _pythonw_path()
    shortcut.Arguments = f'"{COMPANION_MAIN}"'
    shortcut.WorkingDirectory = str(PROJECT_ROOT)
    shortcut.Description = "Cockpit OS — App compagnon"
    shortcut.Save()


def disable() -> None:
    if SHORTCUT_PATH.exists():
        SHORTCUT_PATH.unlink()
