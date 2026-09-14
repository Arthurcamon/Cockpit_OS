"""
Cockpit OS — Service Wi-Fi (onglet Setup)
Lecture de l'état Wi-Fi (adaptateur, réseau connecté, réseaux visibles) et
connexion réelle à un réseau, sous Windows.

IMPORTANT — Lecture du SSID connecté et scan des réseaux visibles :
Windows bloque ces informations (via `netsh wlan show interfaces` / `show
networks`) pour tout processus non-administrateur tant que les "Services de
localisation" ne sont pas activés (Paramètres > Confidentialité et sécurité
> Localisation) — restriction volontaire depuis Windows 10 1803, un scan
Wi-Fi étant considéré comme une donnée de position, quel que soit l'outil
utilisé pour le lire. Sans ce réglage activé sur le PC, l'état renvoyé
signale "location_disabled" plutôt que d'inventer une liste de réseaux vide.

Activer/désactiver l'adaptateur ne nécessite PAS ce réglage, mais nécessite
des droits admin (Enable-NetAdapter/Disable-NetAdapter) — géré via la même
tâche planifiée élevée que le Bluetooth (voir scripts/bt_elevated_action.ps1
et ELEVATED_TASK_NAME dans services/windows_audio.py), avec ses propres
fichiers d'échange pour ne pas interférer avec les actions Bluetooth.
"""

import asyncio
import json
import os
import platform
import re
import subprocess
import tempfile
import time
from core.logger import get_logger

logger = get_logger(__name__)
IS_WINDOWS = platform.system() == "Windows"

# Sans ce flag, chaque subprocess.run ci-dessous ouvre sa PROPRE fenêtre
# console visible (brièvement) dès que le process Python appelant n'a
# lui-même aucune console — le cas depuis que l'app compagnon lance main.py
# avec CREATE_NO_WINDOW (companion_app/server_control.py). Avant ça, main.py
# tournait dans une console visible et les sous-process en héritaient
# silencieusement ; sans ce flag ici, une invite de commandes vide flashe
# désormais à chaque appel (1x/poll Wi-Fi, très visible en continu).
_CREATE_NO_WINDOW = subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0

# Nom historique (créé pour le Bluetooth) — la tâche planifiée exécute
# toujours le même script scripts/bt_elevated_action.ps1, désormais étendu
# pour gérer aussi la bascule de l'adaptateur Wi-Fi. Pas besoin de renommer
# la tâche : ça obligerait chaque utilisateur à relancer setup_admin_task.bat.
ELEVATED_TASK_NAME = "CockpitOS_BluetoothHelper"


def _run_ps(command: str, timeout: float = 4.0):
    """Exécute une commande via PowerShell, sortie forcée en UTF-8 (même
    convention que services/system_monitor.py) — nécessaire car netsh émet
    par défaut dans l'encodage console (pas toujours UTF-8), ce qui casse
    les libellés français accentués ("État", "Désactivé"...) sinon."""
    ps_cmd = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + command
    return subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps_cmd],
        capture_output=True, encoding="utf-8", errors="replace", timeout=timeout,
        creationflags=_CREATE_NO_WINDOW,
    )


def _run_elevated_wifi_toggle(enable: bool):
    """Active/désactive l'adaptateur Wi-Fi via la tâche planifiée élevée.
    Même mécanisme que services/windows_audio.py::_run_elevated_pnp_action,
    avec des fichiers d'échange distincts (préfixe "wifi_") pour ne jamais
    interférer avec une action Bluetooth concurrente.
    Retourne (succès: bool, message_erreur: str)."""
    if not IS_WINDOWS:
        return False, "non disponible hors Windows"
    try:
        tmp = tempfile.gettempdir()
        action_file = os.path.join(tmp, "cockpit_os_wifi_action.json")
        result_file = os.path.join(tmp, "cockpit_os_wifi_result.json")

        if os.path.exists(result_file):
            os.remove(result_file)
        with open(action_file, "w", encoding="utf-8") as f:
            json.dump({"enable": enable}, f)

        res = subprocess.run(
            ["schtasks", "/run", "/tn", ELEVATED_TASK_NAME],
            capture_output=True, encoding="utf-8", errors="replace", timeout=5,
            creationflags=_CREATE_NO_WINDOW,
        )
        if res.returncode != 0:
            return False, "Tâche planifiée introuvable — exécutez scripts/setup_admin_task.bat une fois."

        for _ in range(20):  # ~4s max
            if os.path.exists(result_file):
                with open(result_file, "r", encoding="utf-8-sig") as f:
                    data = json.load(f)
                os.remove(result_file)
                return bool(data.get("ok")), data.get("error", "")
            time.sleep(0.2)
        return False, "Timeout en attendant la tâche élevée."
    except Exception as e:
        return False, str(e)


def _parse_flat_fields(text: str) -> dict:
    """Parse une sortie netsh à plat (ex. `show interfaces`, un seul bloc)
    en dict {clé en minuscules: valeur}."""
    fields: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        fields[key.strip().lower()] = value.strip()
    return fields


_SSID_BLOCK_RE = re.compile(r"^ssid \d+$")


def _parse_network_blocks(text: str) -> list[dict]:
    """Parse la sortie de `netsh wlan show networks mode=bssid` en une
    liste de réseaux {ssid, signal_pct} — un par SSID visible, le signal
    retenu étant le plus fort parmi ses éventuels BSSID (bornes Wi-Fi
    multiples pour un même réseau, ex. mesh)."""
    networks: list[dict] = []
    current: dict | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()

        if _SSID_BLOCK_RE.match(key):
            current = {"ssid": value, "signal_pct": None} if value else None
            if current:
                networks.append(current)
            continue

        if current is None or key != "signal":
            continue
        digits = value.rstrip("%").strip()
        if digits.isdigit():
            val = int(digits)
            if current["signal_pct"] is None or val > current["signal_pct"]:
                current["signal_pct"] = val
    return networks


class WifiService:
    """Lecture périodique de l'état Wi-Fi + connexion/bascule réelles."""

    def __init__(self):
        self._cached_state: dict | None = None

    async def get_current_state(self) -> dict:
        if self._cached_state is not None:
            return self._cached_state
        return await self.refresh_state()

    async def refresh_state(self) -> dict:
        if not IS_WINDOWS:
            return {"type": "wifi.state", "error": "non disponible hors Windows", "enabled": False, "networks": []}
        loop = asyncio.get_event_loop()
        state = await loop.run_in_executor(None, self._read_state_sync)
        self._cached_state = state
        return state

    def _read_state_sync(self) -> dict:
        adapter = self._read_adapter_sync()
        if adapter is None:
            return {"type": "wifi.state", "error": "Aucun adaptateur Wi-Fi détecté", "enabled": False, "networks": []}

        enabled = adapter["status"] != "Disabled"
        state = {
            "type": "wifi.state",
            "enabled": enabled,
            "connected": False,
            "ssid": None,
            "signal_pct": None,
            "networks": [],
        }
        if not enabled:
            return state

        iface = self._read_interface_sync()
        if iface is None:
            # Services de localisation désactivés (ou autre échec netsh) —
            # voir docstring du module. Jamais de réseau inventé ici.
            state["location_disabled"] = True
            return state

        state["connected"] = iface.get("état", "").strip().lower().startswith("conn")
        state["ssid"] = iface.get("ssid") or None
        signal_raw = iface.get("signal", "").rstrip("%").strip()
        if signal_raw.isdigit():
            state["signal_pct"] = int(signal_raw)

        state["networks"] = self._read_networks_sync()
        return state

    def _read_adapter_sync(self) -> dict | None:
        """État de l'adaptateur (activé/désactivé) — ne nécessite ni
        élévation ni services de localisation : Get-NetAdapter et sa
        propriété Status ne sont pas soumis à cette restriction, et leurs
        valeurs ("Up"/"Disabled"/"Disconnected") ne sont pas localisées."""
        try:
            res = _run_ps(
                "Get-NetAdapter -Physical | Where-Object { $_.MediaType -like '*802.11*' } | "
                "Select-Object -First 1 Name, Status | ConvertTo-Json -Compress"
            )
            if res.returncode != 0 or not res.stdout.strip():
                return None
            data = json.loads(res.stdout)
            if not data or not data.get("Name"):
                return None
            return {"name": data.get("Name"), "status": data.get("Status")}
        except Exception as e:
            logger.debug(f"[Wifi] Lecture adaptateur indisponible : {e}")
            return None

    def _read_interface_sync(self) -> dict | None:
        try:
            res = _run_ps("netsh wlan show interfaces")
            combined = (res.stdout or "") + (res.stderr or "")
            if res.returncode != 0 or "localisation" in combined.lower() or "élévation" in combined.lower():
                return None
            fields = _parse_flat_fields(res.stdout)
            return fields or None
        except Exception as e:
            logger.debug(f"[Wifi] Lecture interface indisponible : {e}")
            return None

    def _read_networks_sync(self) -> list[dict]:
        try:
            res = _run_ps("netsh wlan show networks mode=bssid")
            if res.returncode != 0:
                return []
            return _parse_network_blocks(res.stdout)
        except Exception as e:
            logger.debug(f"[Wifi] Lecture réseaux visibles indisponible : {e}")
            return []

    async def set_enabled(self, enabled: bool):
        if not IS_WINDOWS:
            return False, "non disponible hors Windows"
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run_elevated_wifi_toggle, enabled)

    async def connect(self, ssid: str):
        if not IS_WINDOWS:
            return False, "non disponible hors Windows"
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._connect_sync, ssid)

    def _connect_sync(self, ssid: str):
        """Déclenche une connexion réelle à un réseau déjà connu de Windows
        (profil existant portant le même nom que le SSID — netsh ne permet
        pas de fournir un mot de passe pour un réseau totalement inconnu
        depuis cette commande). Le code de retour de netsh confirme
        seulement que la demande a été acceptée, pas que la connexion a
        abouti : l'état réel se met à jour au prochain poll périodique."""
        try:
            safe_ssid = ssid.replace('"', "")
            res = _run_ps(f'netsh wlan connect name="{safe_ssid}" ssid="{safe_ssid}"')
            output = ((res.stdout or "") + (res.stderr or "")).strip()
            return res.returncode == 0, output
        except Exception as e:
            return False, str(e)

    async def handle_command(self, data: dict) -> dict:
        command = data.get("command", "")

        if command == "wifi.toggle":
            enabled = data.get("enabled")
            if enabled is None:
                current = await self.get_current_state()
                enabled = not current.get("enabled", False)
            ok, err = await self.set_enabled(bool(enabled))
            if not ok:
                logger.warning(f"[Wifi] Échec bascule adaptateur : {err}")
                return {
                    "type": "wifi.error",
                    "message": err or "Échec de la bascule Wi-Fi. Exécutez scripts/setup_admin_task.bat une fois (droits admin requis).",
                }
            logger.info(f"[Wifi] Adaptateur {'activé' if enabled else 'désactivé'}")
            return {"type": "wifi.updated", "enabled": bool(enabled)}

        if command == "wifi.connect":
            ssid = data.get("ssid", "")
            if not ssid:
                return {"type": "wifi.error", "message": "SSID manquant"}
            ok, msg = await self.connect(ssid)
            if not ok:
                logger.warning(f"[Wifi] Échec de connexion à {ssid} : {msg}")
                return {"type": "wifi.error", "message": f"Connexion à {ssid} impossible : {msg}"}
            logger.info(f"[Wifi] Connexion à {ssid} lancée")
            return {"type": "wifi.connecting", "ssid": ssid}

        return {"type": "wifi.error", "message": f"Commande Wi-Fi inconnue : {command}"}


# Instance unique partagée dans toute l'application
wifi_service = WifiService()
