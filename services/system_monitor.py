"""
Cockpit OS — Service de supervision système (onglet Setup)
Lit l'utilisation CPU/RAM/disques/réseau (et GPU si détectable) du PC via
psutil, et maintient un court historique en mémoire pour les sparklines.

IMPORTANT — Dépendance :
  pip install psutil   (voir requirements.txt)

Honnêteté des données : aucune valeur n'est inventée. Un composant absent
ou non détectable (GPU sans nvidia-smi, disque sans lettre, etc.) est
simplement omis de la liste plutôt que remplacé par une valeur simulée.
"""

import asyncio
import platform
import subprocess
import time
from collections import deque
from core.logger import get_logger

logger = get_logger(__name__)

IS_WINDOWS = platform.system() == "Windows"

# Sans ce flag, chaque subprocess.run/Popen ci-dessous ouvre sa PROPRE
# fenêtre console visible (brièvement) dès que le process Python appelant
# n'a lui-même aucune console — le cas depuis que l'app compagnon lance
# main.py avec CREATE_NO_WINDOW (companion_app/server_control.py). Ce
# service étant interrogé ~1x/s dès qu'un client est connecté, l'absence
# de ce flag se traduisait par une invite de commandes vide qui flashait
# en continu pendant toute la connexion.
_CREATE_NO_WINDOW = subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError as e:
    PSUTIL_AVAILABLE = False
    logger = get_logger(__name__)
    logger.warning(f"psutil non installé — supervision système désactivée ({e})")

HISTORY_LEN = 30  # ~30 derniers échantillons (30s à 1 poll/s) pour les sparklines

# Palette par catégorie — reprise telle quelle de la maquette (design/mockups/setup-v4.html)
COLOR_CPU = "#5ce1e6"
COLOR_RAM = "#6f97ff"
COLOR_DISK = "#4ade95"
COLOR_NET = "#ff7ab8"
COLOR_GPU = "#a66fff"


class SystemMonitorService:
    """Lecture périodique de l'état système + historique pour sparklines."""

    def __init__(self):
        self._histories: dict[str, deque] = {}
        self._last_net_counters = None
        self._last_net_time = None
        self._disk_media_types: dict[str, str] | None = None  # cache, rempli en arrière-plan
        self._disk_media_lookup_started = False

        # État mis en cache, rafraîchi UNIQUEMENT par le poll périodique
        # (voir get_current_state/refresh_state) — une requête à la demande
        # (system.state.request, envoyée à chaque connexion/reconnexion
        # WebSocket) ne doit jamais déclencher elle-même une nouvelle lecture
        # psutil.cpu_percent() : ce compteur mesure l'usage depuis le DERNIER
        # appel, donc des requêtes à la demande fréquentes (ex: reconnexions
        # répétées) le réinitialisaient sans cesse et faisaient chuter la
        # valeur affichée très en dessous de la réalité (bug signalé le
        # 2026-09-06 : 3% affiché contre 41% réel dans le Gestionnaire des
        # tâches au même instant).
        self._cached_state: dict | None = None

        # Stats WMI regroupées en un seul appel PowerShell (rafraîchi au plus
        # 1x/s, coût d'un sous-processus) :
        #  - PercentProcessorPerformance + MaxClockSpeed : GHz turbo réel
        #    (psutil.cpu_freq() ne renvoie que l'horloge de base sur Windows).
        #  - PercentProcessorTime (Win32_PerfFormattedData_PerfOS_Processor) :
        #    même compteur perfmon que celui utilisé par le Gestionnaire des
        #    tâches pour le CPU — remplace psutil.cpu_percent(), dont
        #    l'algorithme diverge sensiblement du Gestionnaire des tâches sur
        #    les CPU hybrides P-core/E-core (écart signalé le 2026-09-06 :
        #    13% affiché contre 41% réel au même instant, même après la
        #    correction du sous-échantillonnage).
        #  - PercentDiskTime par disque physique (Win32_PerfFormattedData_
        #    PerfDisk_PhysicalDisk) : activité I/O réelle, PAS le taux de
        #    remplissage du disque — bug distinct signalé le même jour
        #    ("les disques ne fonctionnent juste pas" : 96%/53% affiché,
        #    qui était en fait psutil.disk_usage().percent, l'espace disque
        #    utilisé, alors que le Gestionnaire des tâches montrait ~0-1%
        #    d'activité I/O pour des disques au repos).
        self._cpu_pct_performance: float | None = None
        self._cpu_base_mhz: float | None = None
        self._cpu_pct_time: float | None = None
        self._disk_percent_by_letter: dict[str, float] = {}
        self._last_wmi_check_at = 0.0
        self._wmi_lookup_in_flight = False

        # Specs CPU figées (ne changent jamais en cours de session, donc
        # jamais réécrasées une fois lues avec succès — voir _maybe_refresh_
        # wmi_stats) + compteurs Processus/Threads (dynamiques, rafraîchis à
        # chaque passage WMI) : pour la vue détaillée du panneau Système
        # (onglet Setup, étape 6).
        self._cpu_model: str | None = None
        self._cpu_physical_cores: int | None = None
        self._cpu_logical_processors: int | None = None
        self._cpu_l2_cache_kb: float | None = None
        self._cpu_l3_cache_kb: float | None = None
        self._cpu_virtualization: bool | None = None
        self._wmi_process_count: int | None = None
        self._wmi_thread_count: int | None = None

        if PSUTIL_AVAILABLE:
            # Premier appel à cpu_percent() sans intervalle : toujours 0.0,
            # nécessaire pour amorcer le calcul delta des appels suivants.
            try:
                psutil.cpu_percent(interval=None)
            except Exception:
                pass

    def _push_history(self, key: str, value: float) -> list:
        if key not in self._histories:
            self._histories[key] = deque(maxlen=HISTORY_LEN)
        self._histories[key].append(round(value, 1))
        return list(self._histories[key])

    # ── Détection SSD/HDD (best-effort, en cache) ──────────────────────────

    def _start_disk_media_lookup(self):
        """Lance une seule fois, en arrière-plan, la résolution lettre→type
        de disque (SSD/HDD) via PowerShell. Best-effort : en cas d'échec,
        les disques restent simplement libellés "Disque" (jamais inventé)."""
        if self._disk_media_lookup_started or not IS_WINDOWS:
            return
        self._disk_media_lookup_started = True

        def _run():
            try:
                ps_cmd = (
                    "Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object { "
                    "  $d = $_ | Get-Disk -ErrorAction SilentlyContinue; "
                    "  if ($d) { "
                    "    $p = Get-PhysicalDisk -DeviceNumber $d.Number -ErrorAction SilentlyContinue; "
                    "    [PSCustomObject]@{ DriveLetter = $_.DriveLetter; MediaType = $p.MediaType } "
                    "  } "
                    "} | ConvertTo-Json -Compress"
                )
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_cmd],
                    capture_output=True, encoding="utf-8", errors="replace", timeout=6,
                    creationflags=_CREATE_NO_WINDOW,
                )
                if res.returncode == 0 and res.stdout.strip():
                    import json
                    raw = json.loads(res.stdout)
                    if isinstance(raw, dict):
                        raw = [raw]
                    mapping = {}
                    for item in raw:
                        letter = item.get("DriveLetter")
                        media = item.get("MediaType") or ""
                        if letter:
                            mapping[str(letter).upper()] = media
                    self._disk_media_types = mapping
                    logger.debug(f"Types de disques détectés : {mapping}")
            except Exception as e:
                logger.debug(f"Détection SSD/HDD indisponible : {e}")
                self._disk_media_types = {}

        asyncio.get_running_loop().run_in_executor(None, _run)

    # ── Stats WMI regroupées (CPU % Gestionnaire des tâches, GHz turbo, ────
    # ── disque % activité I/O réelle) — un seul sous-processus PowerShell ──

    def _maybe_refresh_wmi_stats(self):
        """Rafraîchit en arrière-plan (au plus 1x/s) les stats lues via WMI
        qui n'ont pas d'équivalent fiable dans psutil sur Windows : voir le
        commentaire dans __init__ pour le détail de chaque valeur et le bug
        qu'elle corrige."""
        now = time.time()
        if not IS_WINDOWS or self._wmi_lookup_in_flight or (now - self._last_wmi_check_at) < 1.0:
            return
        self._wmi_lookup_in_flight = True
        self._last_wmi_check_at = now

        def _run():
            try:
                ps_cmd = (
                    "$cpuTime = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor "
                    "-Filter \"Name='_Total'\" -ErrorAction SilentlyContinue; "
                    "$perf = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation "
                    "-Filter \"Name='_Total'\" -ErrorAction SilentlyContinue; "
                    "$c = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1; "
                    "$sys = Get-CimInstance Win32_PerfFormattedData_PerfOS_System -ErrorAction SilentlyContinue; "
                    "$disks = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk "
                    "-ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '_Total' } | "
                    "Select-Object Name, PercentDiskTime; "
                    "[PSCustomObject]@{ "
                    "PercentProcessorTime = $cpuTime.PercentProcessorTime; "
                    "PercentProcessorPerformance = $perf.PercentProcessorPerformance; "
                    "MaxClockSpeed = $c.MaxClockSpeed; "
                    "CpuName = $c.Name; "
                    "NumberOfCores = $c.NumberOfCores; "
                    "NumberOfLogicalProcessors = $c.NumberOfLogicalProcessors; "
                    "L2CacheSize = $c.L2CacheSize; "
                    "L3CacheSize = $c.L3CacheSize; "
                    "VirtualizationFirmwareEnabled = $c.VirtualizationFirmwareEnabled; "
                    "Processes = $sys.Processes; "
                    "Threads = $sys.Threads; "
                    "Disks = @($disks) "
                    "} | ConvertTo-Json -Compress -Depth 4"
                )
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_cmd],
                    capture_output=True, encoding="utf-8", errors="replace", timeout=3,
                    creationflags=_CREATE_NO_WINDOW,
                )
                if res.returncode == 0 and res.stdout.strip():
                    import json
                    import re
                    data = json.loads(res.stdout)
                    if data.get("PercentProcessorTime") is not None:
                        self._cpu_pct_time = float(data["PercentProcessorTime"])
                    if data.get("PercentProcessorPerformance") is not None:
                        self._cpu_pct_performance = float(data["PercentProcessorPerformance"])
                    if data.get("MaxClockSpeed") is not None:
                        self._cpu_base_mhz = float(data["MaxClockSpeed"])
                    # Specs figées : lues une seule fois avec succès puis
                    # jamais réécrasées (évite qu'un échec WMI ponctuel les
                    # efface après coup — voir docstring des attributs).
                    if self._cpu_model is None and data.get("CpuName"):
                        self._cpu_model = str(data["CpuName"]).strip()
                    if self._cpu_physical_cores is None and data.get("NumberOfCores") is not None:
                        self._cpu_physical_cores = int(data["NumberOfCores"])
                    if self._cpu_logical_processors is None and data.get("NumberOfLogicalProcessors") is not None:
                        self._cpu_logical_processors = int(data["NumberOfLogicalProcessors"])
                    if self._cpu_l2_cache_kb is None and data.get("L2CacheSize") is not None:
                        self._cpu_l2_cache_kb = float(data["L2CacheSize"])
                    if self._cpu_l3_cache_kb is None and data.get("L3CacheSize") is not None:
                        self._cpu_l3_cache_kb = float(data["L3CacheSize"])
                    if self._cpu_virtualization is None and data.get("VirtualizationFirmwareEnabled") is not None:
                        self._cpu_virtualization = bool(data["VirtualizationFirmwareEnabled"])
                    if data.get("Processes") is not None:
                        self._wmi_process_count = int(data["Processes"])
                    if data.get("Threads") is not None:
                        self._wmi_thread_count = int(data["Threads"])
                    disks_raw = data.get("Disks") or []
                    if isinstance(disks_raw, dict):
                        disks_raw = [disks_raw]
                    disk_map = {}
                    for d in disks_raw:
                        pct = d.get("PercentDiskTime")
                        name = d.get("Name") or ""
                        if pct is None:
                            continue
                        for letter in re.findall(r"([A-Za-z]):", name):
                            disk_map[letter.upper()] = float(pct)
                    if disk_map:
                        self._disk_percent_by_letter = disk_map
            except Exception as e:
                logger.debug(f"Lecture stats WMI indisponible : {e}")
            finally:
                self._wmi_lookup_in_flight = False

        asyncio.get_running_loop().run_in_executor(None, _run)

    def _current_ghz(self) -> float | None:
        """GHz estimé à partir du % de performance WMI si disponible
        (rafraîchi en arrière-plan, voir _maybe_refresh_wmi_stats), sinon
        repli sur psutil.cpu_freq() — qui, sur Windows, ne donne souvent
        que l'horloge de base (jamais présenté comme "en direct" dans ce
        cas, juste la meilleure valeur disponible)."""
        if self._cpu_base_mhz and self._cpu_pct_performance is not None:
            return round(self._cpu_base_mhz * self._cpu_pct_performance / 100 / 1000, 2)
        try:
            freq = psutil.cpu_freq()
            return round(freq.current / 1000, 2) if freq else None
        except Exception:
            return None

    def _disk_label(self, letter: str) -> str:
        media = (self._disk_media_types or {}).get(letter.upper())
        if media == "SSD":
            return "SSD"
        if media == "HDD":
            return "HDD"
        return "Disque"

    # ── GPU (best-effort via nvidia-smi, aucune dépendance ajoutée) ────────

    def _read_gpus_sync(self) -> list[dict]:
        """Tente de lire les GPU NVIDIA via `nvidia-smi` (déjà présent sur
        toute machine avec les pilotes NVIDIA — aucune lib Python requise).
        Retourne une liste VIDE si nvidia-smi est absent ou échoue : jamais
        de GPU inventé. Les GPU non-NVIDIA (Intel/AMD) ne sont pas
        supportés pour l'instant faute d'un outil équivalent déjà présent."""
        try:
            res = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,utilization.gpu,temperature.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, encoding="utf-8", errors="replace", timeout=2,
                creationflags=_CREATE_NO_WINDOW,
            )
            if res.returncode != 0 or not res.stdout.strip():
                return []
            gpus = []
            for line in res.stdout.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 3:
                    gpus.append({
                        "name": parts[0],
                        "util_pct": float(parts[1]),
                        "temp_c": float(parts[2]),
                    })
            return gpus
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
            return []

    # ── État complet ────────────────────────────────────────────────────────

    async def get_current_state(self) -> dict:
        """Snapshot pour une demande à la demande (system.state.request) —
        retourne le dernier état calculé par le poll périodique plutôt que
        de déclencher une nouvelle lecture (voir _cached_state, et le
        commentaire dans __init__ sur le bug de sous-échantillonnage du
        CPU). Ne calcule un état frais que si aucun poll n'a encore eu lieu
        (tout premier appel après démarrage du serveur)."""
        if not PSUTIL_AVAILABLE:
            return {"type": "system.state", "error": "psutil non installé côté serveur", "components": []}
        if self._cached_state is not None:
            return self._cached_state
        return await self.refresh_state()

    async def refresh_state(self) -> dict:
        """Calcule un état FRAIS (vraie lecture psutil) et le met en cache.
        Seul le poll périodique (core/app.py::_system_polling_task) doit
        appeler cette méthode — jamais un handler à la demande, pour ne
        jamais fausser le calcul delta de psutil.cpu_percent()."""
        if not PSUTIL_AVAILABLE:
            return {"type": "system.state", "error": "psutil non installé côté serveur", "components": []}

        # Lancés ici (boucle asyncio principale) et non depuis _read_state_sync :
        # ce dernier tourne dans un thread d'executor sans event loop propre,
        # où asyncio.get_event_loop() lève une RuntimeError.
        self._start_disk_media_lookup()
        self._maybe_refresh_wmi_stats()

        loop = asyncio.get_event_loop()
        state = await loop.run_in_executor(None, self._read_state_sync)
        self._cached_state = state
        return state

    def _read_state_sync(self) -> dict:
        components = []

        # -- CPU --------------------------------------------------------
        # Source principale : WMI PercentProcessorTime (_Total), le même
        # compteur perfmon que le Gestionnaire des tâches — psutil.cpu_percent()
        # gardé uniquement comme repli si WMI est indisponible (voir __init__).
        psutil_cpu_pct = psutil.cpu_percent(interval=None)
        cpu_pct = self._cpu_pct_time if self._cpu_pct_time is not None else psutil_cpu_pct
        ghz = self._current_ghz()
        sub = f"{cpu_pct:.0f}%" + (f" · {ghz:.2f} GHz".replace(".", ",") if ghz else "")

        uptime_s = int(time.time() - psutil.boot_time())

        components.append({
            "id": "cpu", "name": "Processeur", "sub": sub,
            "percent": round(cpu_pct, 1), "color": COLOR_CPU,
            "history": self._push_history("cpu", cpu_pct),
            "detail": {
                "model": self._cpu_model,
                "current_ghz": round(ghz, 2) if ghz else None,
                "processes": self._wmi_process_count if self._wmi_process_count is not None else len(psutil.pids()),
                "threads": self._wmi_thread_count,
                "uptime_s": uptime_s,
                "specs": {
                    "base_ghz": round(self._cpu_base_mhz / 1000, 2) if self._cpu_base_mhz else None,
                    "cores": self._cpu_physical_cores,
                    "logical_processors": self._cpu_logical_processors,
                    "virtualization": self._cpu_virtualization,
                    "l2_cache_mb": round(self._cpu_l2_cache_kb / 1024, 1) if self._cpu_l2_cache_kb else None,
                    "l3_cache_mb": round(self._cpu_l3_cache_kb / 1024, 1) if self._cpu_l3_cache_kb else None,
                },
            },
        })

        # -- RAM ----------------------------------------------------------
        vm = psutil.virtual_memory()
        used_go = vm.used / (1024 ** 3)
        total_go = vm.total / (1024 ** 3)
        sub = f"{used_go:.1f} / {total_go:.1f} Go ({vm.percent:.0f}%)".replace(".", ",")
        components.append({
            "id": "ram", "name": "Mémoire", "sub": sub,
            "percent": round(vm.percent, 1), "color": COLOR_RAM,
            "history": self._push_history("ram", vm.percent),
        })

        # -- Disques (un par lettre de lecteur fixe) -----------------------
        seen_devices = set()
        disk_index = 0
        for part in psutil.disk_partitions(all=False):
            if "cdrom" in part.opts or part.fstype == "":
                continue
            if part.device in seen_devices:
                continue
            seen_devices.add(part.device)
            letter = part.mountpoint.rstrip("\\/").rstrip(":") or part.device
            label = self._disk_label(letter)
            key = f"disk-{letter}"
            # % d'activité I/O réelle (WMI PercentDiskTime), PAS le taux de
            # remplissage du disque (psutil.disk_usage().percent) — voir le
            # commentaire dans __init__. Si WMI n'a pas encore répondu (juste
            # après le démarrage, ou échec), on affiche 0% plutôt que de
            # retomber sur la mauvaise métrique.
            activity_pct = self._disk_percent_by_letter.get(letter.upper())
            if activity_pct is None:
                sub = f"{label} · —"
                percent_value = 0.0
            else:
                activity_pct = min(100.0, activity_pct)
                sub = f"{label} · {activity_pct:.0f}%"
                percent_value = activity_pct
            components.append({
                "id": key, "name": f"Disque {disk_index} ({letter}:)", "sub": sub,
                "percent": round(percent_value, 1), "color": COLOR_DISK,
                "history": self._push_history(key, percent_value),
            })
            disk_index += 1

        # -- Réseau (adaptateur Wi-Fi si détecté) --------------------------
        wifi_row = self._read_network_component()
        if wifi_row:
            components.append(wifi_row)

        # -- GPU (best-effort, nvidia-smi) ---------------------------------
        gpus = self._read_gpus_sync()
        for i, gpu in enumerate(gpus):
            key = f"gpu-{i}"
            sub = f"{gpu['name']} · {gpu['util_pct']:.0f}% ({gpu['temp_c']:.0f}°C)"
            components.append({
                "id": key, "name": f"GPU {i}", "sub": sub,
                "percent": round(gpu["util_pct"], 1), "color": COLOR_GPU,
                "history": self._push_history(key, gpu["util_pct"]),
            })

        return {"type": "system.state", "components": components, "source": "windows" if IS_WINDOWS else "unsupported"}

    def _read_network_component(self) -> dict | None:
        """Débit Wi-Fi combiné (down+up) sur 100 Mb/s, comme demandé —
        None si aucun adaptateur dont le nom évoque le Wi-Fi n'est trouvé
        (jamais de repli sur le réseau filaire pour ne pas mal étiqueter)."""
        try:
            counters = psutil.net_io_counters(pernic=True)
        except Exception:
            return None

        wifi_key = None
        for name in counters:
            low = name.lower()
            if "wi-fi" in low or "wifi" in low or "wireless" in low or "wlan" in low:
                wifi_key = name
                break
        if not wifi_key:
            return None

        c = counters[wifi_key]
        now = time.time()
        prev = self._last_net_counters
        prev_time = self._last_net_time
        self._last_net_counters = {"bytes_sent": c.bytes_sent, "bytes_recv": c.bytes_recv}
        self._last_net_time = now

        if not prev or not prev_time or now <= prev_time:
            down_mbps = up_mbps = 0.0
        else:
            elapsed = now - prev_time
            down_mbps = max(0.0, (c.bytes_recv - prev["bytes_recv"]) * 8 / 1_000_000 / elapsed)
            up_mbps = max(0.0, (c.bytes_sent - prev["bytes_sent"]) * 8 / 1_000_000 / elapsed)

        combined = down_mbps + up_mbps
        percent = min(100.0, (combined / 100.0) * 100.0)
        sub = f"↓ {down_mbps:.1f} · ↑ {up_mbps:.1f} Mbit/s".replace(".", ",")
        return {
            "id": "wifi", "name": "Wi-Fi", "sub": sub,
            "percent": round(percent, 1), "color": COLOR_NET,
            "history": self._push_history("wifi", percent),
        }


# Instance unique partagée dans toute l'application
system_monitor_service = SystemMonitorService()
