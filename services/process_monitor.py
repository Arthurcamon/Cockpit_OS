"""
Cockpit OS — Service de supervision des applications ouvertes (onglet Setup)

Détecte les applications réellement ouvertes en énumérant les fenêtres
visibles au premier plan (EnumWindows via ctypes — même technique que
core/shortcuts.py::get_real_windows, seule différence : on remonte aussi le
PID propriétaire, nécessaire pour lire CPU/RAM/disque par processus via
psutil et pour permettre la fermeture réelle de l'app, voir core/setup.py).
C'est délibérément différent d'un simple psutil.process_iter() : ça exclut
naturellement les centaines de processus/services d'arrière-plan sans
fenêtre, pour ne montrer que ce qu'un Alt-Tab montrerait.

Honnêteté des données : le débit RÉSEAU par processus n'est PAS disponible
via psutil sur Windows (contrairement au disque, aucun compteur perfmon
léger équivalent par processus n'existe — la seule voie fiable est une
session ETW, hors de portée pour l'instant). La valeur "net_mb_s" est donc
toujours None côté backend, affichée comme "—" côté frontend plutôt qu'une
valeur inventée — à décider ensemble si ça vaut le coût d'implémentation.
"""

import asyncio
import ctypes
import platform
import re
import time
from core.logger import get_logger

logger = get_logger(__name__)
IS_WINDOWS = platform.system() == "Windows"

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

# Reprise de la même liste que core/shortcuts.py::get_real_windows, pour ne
# jamais lister ces fenêtres système comme des "applications ouvertes".
_IGNORED_TITLES = {
    "Program Manager", "Settings", "Microsoft Text Input Application",
    "Cortana", "NVIDIA GeForce Overlay",
}

_GWL_EXSTYLE = -20
_WS_EX_TOOLWINDOW = 0x00000080

# Icône + nom lisible par exécutable connu — purement cosmétique (jamais une
# donnée mesurée) : sert à remplacer le titre de fenêtre brut (souvent un nom
# de document/onglet à rallonge, ex. "Rapport Q3.docx - Word", pas un nom
# d'appli) par quelque chose qu'un utilisateur reconnaît d'un coup d'œil.
# Repli générique (icône par défaut + nom dérivé de l'exécutable, voir
# _friendly_name_for) pour tout process non listé ici.
_APP_META = {
    "chrome.exe": ("🌐", "Google Chrome"),
    "msedge.exe": ("🌐", "Microsoft Edge"),
    "firefox.exe": ("🌐", "Firefox"),
    "discord.exe": ("💬", "Discord"),
    "steam.exe": ("🎮", "Steam"),
    "steamwebhelper.exe": ("🎮", "Steam"),
    "obs64.exe": ("🎬", "OBS Studio"),
    "obs32.exe": ("🎬", "OBS Studio"),
    "deezer.exe": ("🎵", "Deezer"),
    "spotify.exe": ("🎵", "Spotify"),
    "simhub.exe": ("🖥", "SimHub"),
    "simhub64.exe": ("🖥", "SimHub"),
    "code.exe": ("💻", "VS Code"),
    "explorer.exe": ("🗂", "Explorateur de fichiers"),
    "claude.exe": ("🤖", "Claude"),
    # Suite Office — noms d'exécutable historiques (WINWORD, POWERPNT) très
    # éloignés du nom usuel, jamais devinables par le repli générique.
    "winword.exe": ("📄", "Word"),
    "excel.exe": ("📊", "Excel"),
    "powerpnt.exe": ("📽", "PowerPoint"),
    "outlook.exe": ("📧", "Outlook"),
}
_DEFAULT_ICON = "📦"


class ProcessMonitorService:
    """Lecture périodique des applications ouvertes (fenêtres visibles) +
    CPU/RAM/disque par processus."""

    def __init__(self):
        self._proc_cache: dict[int, "psutil.Process"] = {}
        self._last_io: dict[int, dict] = {}
        self._last_io_time: float | None = None
        # Même principe que SystemMonitorService : seul le poll périodique
        # doit déclencher une vraie lecture (proc.cpu_percent() mesure aussi
        # depuis le dernier appel, par processus cette fois).
        self._cached_state: dict | None = None

    def _icon_for(self, exe_name: str) -> str:
        meta = _APP_META.get((exe_name or "").lower())
        return meta[0] if meta else _DEFAULT_ICON

    def _friendly_name_for(self, exe_name: str) -> str | None:
        """Nom lisible pour un exécutable connu, sinon un nom dérivé du nom
        de fichier (ex. "epic_games_launcher.exe" -> "Epic Games Launcher"),
        toujours préférable au titre de fenêtre brut. None seulement si
        l'exécutable lui-même est vide (cas quasi impossible)."""
        meta = _APP_META.get((exe_name or "").lower())
        if meta:
            return meta[1]
        if not exe_name:
            return None
        base = exe_name[:-4] if exe_name.lower().endswith(".exe") else exe_name
        base = base.replace("_", " ").replace("-", " ")
        # Sépare les exécutables en PascalCase/camelCase (ex. "ApplicationFrameHost"
        # -> "Application Frame Host") : un .capitalize() par mot écraserait cette
        # casse existante (donnerait "Applicationframehost").
        base = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", base).strip()
        if not base:
            return None
        # Un mot déjà en PascalCase (ex. "Frame") est gardé tel quel ; un mot
        # tout en majuscules (ex. exécutables nommés "EXCEL.EXE" sur disque)
        # ou tout en minuscules est normalisé en casse standard.
        return " ".join(w if (w[:1].isupper() and not w.isupper()) else w.capitalize() for w in base.split())

    def _enum_app_windows_sync(self) -> dict[int, str]:
        """PID -> titre de la première fenêtre visible et significative
        trouvée pour ce process (EnumWindows, ctypes pur — aucune dépendance
        ajoutée, cohérent avec core/shortcuts.py::get_real_windows)."""
        result: dict[int, str] = {}
        if not IS_WINDOWS:
            return result
        try:
            user32 = ctypes.windll.user32

            def _callback(hwnd, _extra):
                if not user32.IsWindowVisible(hwnd):
                    return True
                length = user32.GetWindowTextLengthW(hwnd)
                if length == 0:
                    return True
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value.strip()
                if not title or title in _IGNORED_TITLES or title.startswith("Default IME"):
                    return True
                # Fenêtres "outil" (barres flottantes, tooltips) : pas des
                # applications à part entière, même filtre que le taskbar.
                ex_style = user32.GetWindowLongW(hwnd, _GWL_EXSTYLE)
                if ex_style & _WS_EX_TOOLWINDOW:
                    return True
                pid = ctypes.c_ulong()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value and pid.value not in result:
                    result[pid.value] = title
                return True

            WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            user32.EnumWindows(WNDENUMPROC(_callback), 0)
        except Exception as e:
            logger.error(f"[ProcessMonitor] Erreur énumération fenêtres : {e}")
        return result

    async def get_current_state(self) -> dict:
        if not PSUTIL_AVAILABLE:
            return {"type": "apps.state", "error": "psutil non installé côté serveur", "apps": []}
        if self._cached_state is not None:
            return self._cached_state
        return await self.refresh_state()

    async def refresh_state(self) -> dict:
        if not PSUTIL_AVAILABLE:
            return {"type": "apps.state", "error": "psutil non installé côté serveur", "apps": []}
        loop = asyncio.get_event_loop()
        state = await loop.run_in_executor(None, self._read_state_sync)
        self._cached_state = state
        return state

    def _read_state_sync(self) -> dict:
        windows = self._enum_app_windows_sync()
        now = time.time()
        elapsed = (now - self._last_io_time) if self._last_io_time else None
        new_io: dict[int, dict] = {}
        apps = []

        for pid, title in windows.items():
            try:
                proc = self._proc_cache.get(pid)
                if proc is None:
                    proc = psutil.Process(pid)
                    proc.cpu_percent(interval=None)  # amorce le calcul delta
                    self._proc_cache[pid] = proc

                exe_name = proc.name()
                cpu_pct = proc.cpu_percent(interval=None)
                mem_mb = proc.memory_info().rss / (1024 ** 2)

                disk_mb_s = None
                try:
                    io = proc.io_counters()
                    new_io[pid] = {"read": io.read_bytes, "write": io.write_bytes}
                    prev = self._last_io.get(pid)
                    if prev and elapsed and elapsed > 0:
                        delta = (io.read_bytes - prev["read"]) + (io.write_bytes - prev["write"])
                        disk_mb_s = max(0.0, delta / (1024 ** 2) / elapsed)
                except (psutil.AccessDenied, AttributeError):
                    pass

                display_name = self._friendly_name_for(exe_name) or title
                apps.append({
                    "pid": pid,
                    "name": display_name if len(display_name) <= 40 else display_name[:37] + "…",
                    "icon": self._icon_for(exe_name),
                    "cpu_pct": round(cpu_pct, 1),
                    "mem_mb": round(mem_mb, 0),
                    "disk_mb_s": round(disk_mb_s, 2) if disk_mb_s is not None else None,
                    # Non disponible via psutil sur Windows — voir docstring
                    # du module. Jamais de valeur inventée.
                    "net_mb_s": None,
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        # Purge le cache des process disparus (évite une fuite mémoire lente
        # sur une session de plusieurs heures en voiture).
        alive_pids = set(windows.keys())
        for pid in list(self._proc_cache.keys()):
            if pid not in alive_pids:
                del self._proc_cache[pid]
        for pid in list(self._last_io.keys()):
            if pid not in alive_pids:
                del self._last_io[pid]

        self._last_io = new_io
        self._last_io_time = now

        # Ordre stable (alphabétique) plutôt que trié par CPU% — évite que
        # la grille se réordonne visuellement à chaque tick (~2s), ce qui
        # gênerait un appui sur "Fermer l'app" pile au mauvais moment.
        apps.sort(key=lambda a: a["name"].lower())

        return {"type": "apps.state", "apps": apps}


process_monitor_service = ProcessMonitorService()
