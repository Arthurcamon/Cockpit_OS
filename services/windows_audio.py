"""
Cockpit OS — Service Windows Audio
Gestion du volume et des périphériques audio Windows via pycaw.

IMPORTANT — Dépendances Windows :
  pip install pycaw comtypes
"""

import asyncio
import platform
from core.logger import get_logger

logger = get_logger(__name__)

IS_WINDOWS = platform.system() == "Windows"

if IS_WINDOWS:
    try:
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        from comtypes import CLSCTX_ALL, CoInitialize, CoUninitialize
        PYCAW_AVAILABLE = True
        logger.info("pycaw chargé — contrôle audio Windows actif")
    except ImportError:
        PYCAW_AVAILABLE = False
        logger.warning("pycaw non installé — mode simulation activé")
else:
    PYCAW_AVAILABLE = False
    logger.info("Système non-Windows détecté — audio en mode simulation")


def _get_windows_audio_devices():
    if not IS_WINDOWS:
        return None, None
    try:
        import subprocess, json
        ps_cmd = (
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
            "Get-PnpDevice -Class AudioEndpoint | "
            "Where-Object {$_.Present -eq $true} | "
            "Select-Object FriendlyName, InstanceId, Status | "
            "ConvertTo-Json"
        )
        res = subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, encoding="utf-8", errors="replace", timeout=3)
        if res.returncode == 0 and res.stdout.strip():
            raw = json.loads(res.stdout)
            if isinstance(raw, dict):
                raw = [raw]
            outputs, inputs = [], []
            for item in raw:
                fname = item.get("FriendlyName", "")
                iid = item.get("InstanceId", "")
                if not fname:
                    continue
                is_input = any(term in fname.lower() for term in ["micro", "capture", "entrée", "input", "line in"])
                dev_item = {
                    "id": iid,
                    "name": fname,
                    "active": False,
                    "icon": ("🎙️" if is_input else ("🎧" if "head" in fname.lower() or "casque" in fname.lower() else "🔊"))
                }
                if is_input:
                    inputs.append(dev_item)
                else:
                    outputs.append(dev_item)
            if outputs or inputs:
                return outputs, inputs
    except Exception as e:
        logger.debug(f"PnP audio devices enumeration fallback: {e}")
    return None, None


def _get_windows_bluetooth_devices():
    if not IS_WINDOWS:
        return None
    try:
        import subprocess, json
        ps_cmd = (
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
            "Get-PnpDevice -Class Bluetooth | "
            "Where-Object {$_.InstanceId -like 'BTHENUM\\*' -or $_.InstanceId -like 'BTHLE\\*'} | "
            "Select-Object FriendlyName, InstanceId, Status | "
            "ConvertTo-Json"
        )
        res = subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, encoding="utf-8", errors="replace", timeout=3)
        if res.returncode == 0 and res.stdout.strip():
            raw = json.loads(res.stdout)
            if isinstance(raw, dict):
                raw = [raw]
            
            bt_dict = {}
            ignore_keywords = [
                "énumérateur", "enumerateur", "microsoft", "gatt", "attributes", 
                "rfcomm", "pbap", "map ", "hands-free ag", "bthle"
            ]
            prefixes_to_strip = [
                "Transport Avrcp ", "Transport LE ", "Transport ", "Service "
            ]

            for item in raw:
                fname = item.get("FriendlyName", "").strip()
                iid = item.get("InstanceId", "")
                status = item.get("Status", "")
                if not fname or not iid:
                    continue
                iid_upper = iid.upper()
                if not (iid_upper.startswith("BTHENUM\\") or iid_upper.startswith("BTHLE\\")):
                    continue
                
                fn_lower = fname.lower()
                if any(kw in fn_lower for kw in ignore_keywords):
                    continue

                clean_name = fname
                for p in prefixes_to_strip:
                    if clean_name.startswith(p):
                        clean_name = clean_name[len(p):].strip()

                if not clean_name:
                    continue

                is_conn = (status.upper() == "OK")
                norm_key = clean_name.lower()

                if norm_key in bt_dict:
                    if is_conn:
                        bt_dict[norm_key]["connected"] = True
                        bt_dict[norm_key]["id"] = iid
                else:
                    icon = "📶"
                    c_lower = clean_name.lower()
                    if any(x in c_lower for x in ["head", "casque", "buds", "airpods", "wh-", "wf-", "sony", "bose"]): icon = "🎧"
                    elif any(x in c_lower for x in ["key", "clavier"]): icon = "⌨️"
                    elif any(x in c_lower for x in ["mouse", "souris"]): icon = "🖱️"
                    elif any(x in c_lower for x in ["speaker", "enceinte", "jbl", "boom"]): icon = "🔊"
                    elif any(x in c_lower for x in ["phone", "galaxy", "iphone"]): icon = "📱"

                    bt_dict[norm_key] = {
                        "id": iid,
                        "name": clean_name,
                        "type": "bluetooth",
                        "connected": is_conn,
                        "paired": True,
                        "battery": None,
                        "icon": icon
                    }

            return list(bt_dict.values())
    except Exception as e:
        logger.debug(f"PnP Bluetooth enumeration fallback: {e}")
    return None


def _get_windows_bluetooth_radio_status():
    """
    Interroge l'état réel du radio/adaptateur Bluetooth sous Windows via PowerShell.
    Cible les entrées de la classe Bluetooth dont l'InstanceId commence par "BTH\"
    (adaptateur radio physique, à l'exclusion de BTHENUM\ et BTHLE\).
    Retourne (True, instance_id) si Status == "OK", (False, instance_id) si désactivé/erreur,
    ou (None, None) en cas d'échec de la requête.
    """
    if not IS_WINDOWS:
        return None, None
    try:
        import subprocess, json
        ps_cmd = (
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
            "Get-PnpDevice -Class Bluetooth | "
            "Where-Object {$_.InstanceId -like 'BTH\\*' -and $_.InstanceId -notlike 'BTHENUM\\*' -and $_.InstanceId -notlike 'BTHLE\\*'} | "
            "Select-Object FriendlyName, InstanceId, Status | "
            "ConvertTo-Json"
        )
        res = subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, encoding="utf-8", errors="replace", timeout=3)
        if res.returncode == 0 and res.stdout.strip():
            raw = json.loads(res.stdout)
            if isinstance(raw, dict):
                raw = [raw]
            for item in raw:
                iid = item.get("InstanceId", "")
                status = item.get("Status", "")
                if not iid:
                    continue
                iid_upper = iid.upper()
                if iid_upper.startswith("BTH\\") and not (iid_upper.startswith("BTHENUM\\") or iid_upper.startswith("BTHLE\\")):
                    is_ok = (status.upper() == "OK")
                    return is_ok, iid
            return False, None
    except Exception as e:
        logger.debug(f"Erreur requête statut radio Bluetooth Windows: {e}")
    return None, None


class WindowsAudioService:
    """
    Gère le volume, les applications audio, les périphériques audio (sortie/entrée)
    et les options Bluetooth sous Windows / Simulation.
    """

    def __init__(self):
        self._sim_volume = 0.65
        self._sim_muted = False
        self._sim_apps = [
            {"name": "Deezer", "pid": 1234, "volume": 1.0, "muted": False},
            {"name": "Chrome", "pid": 5678, "volume": 0.8, "muted": False},
        ]
        self._active_output_id = "out_speakers"
        self._active_input_id = "in_mic"
        self._sim_output_devices = [
            {"id": "out_speakers", "name": "Haut-parleurs (Realtek High Definition Audio)", "active": True, "icon": "🔊"},
            {"id": "out_headphones", "name": "Casque Bluetooth (Sony WH-1000XM4)", "active": False, "icon": "🎧"},
            {"id": "out_hdmi", "name": "Écran TV / HDMI (NVIDIA High Definition)", "active": False, "icon": "🖥️"}
        ]
        self._sim_input_devices = [
            {"id": "in_mic", "name": "Microphone (Realtek High Definition Audio)", "active": True, "icon": "🎙️"},
            {"id": "in_headset", "name": "Microphone Casque (Sony WH-1000XM4)", "active": False, "icon": "🎧"}
        ]
        self._bluetooth_enabled = True
        self._bluetooth_devices = [
            {"id": "bt_sony", "name": "WH-1000XM4", "type": "casque", "connected": True, "paired": True, "battery": 85, "icon": "🎧"}
        ]
        import time
        self._last_pnp_fetch_time = 0
        self._cached_real_outputs = None
        self._cached_real_inputs = None
        self._cached_real_bt = None
        self._cached_real_bt_radio_status = None
        self._cached_real_bt_radio_iid = None

        # Cache de l'interface COM IAudioEndpointVolume — évite de la recréer (Activate())
        # à chaque commande, ce qui est relativement coûteux et devenait un goulot
        # d'étranglement pendant un glissement de slider (dizaines de commandes/seconde
        # même throttlées côté frontend). Invalidé et reconstruit automatiquement en cas
        # d'échec (ex: périphérique de sortie par défaut changé en cours de route).
        self._cached_vol_ctrl = None

    def _get_volume_controller(self):
        """
        Retourne le contrôleur IAudioEndpointVolume, mis en cache sur l'instance.
        Compatible avec toutes les versions de pycaw (ancien COM direct ou
        nouveau wrapper AudioDevice avec attribut _dev).
        """
        if self._cached_vol_ctrl is not None:
            return self._cached_vol_ctrl
        speakers = AudioUtilities.GetSpeakers()
        # Versions récentes de pycaw : GetSpeakers() peut retourner un
        # wrapper AudioDevice dont le COM device est dans ._dev
        if hasattr(speakers, '_dev'):
            speakers = speakers._dev
        interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        self._cached_vol_ctrl = interface.QueryInterface(IAudioEndpointVolume)
        return self._cached_vol_ctrl

    def _invalidate_volume_controller(self):
        """À appeler quand le périphérique de sortie par défaut change, ou si un appel COM échoue."""
        self._cached_vol_ctrl = None

    def _with_volume_controller(self, fn):
        """
        Exécute fn(vol_ctrl) avec le contrôleur mis en cache ; si ça échoue (interface
        périmée — device débranché/changé entre-temps), invalide le cache et retente
        une fois avec une interface fraîchement recréée avant d'abandonner.
        """
        try:
            return fn(self._get_volume_controller())
        except Exception as e:
            logger.debug(f"Contrôleur volume périmé, reconstruction : {e}")
            self._invalidate_volume_controller()
            return fn(self._get_volume_controller())

    def _refresh_pnp_devices_sync(self):
        import time
        try:
            real_out, real_in = _get_windows_audio_devices()
            real_bt = _get_windows_bluetooth_devices()
            bt_radio_status, bt_radio_iid = _get_windows_bluetooth_radio_status()
            if real_out is not None:
                self._cached_real_outputs = real_out
            if real_in is not None:
                self._cached_real_inputs = real_in
            if real_bt is not None:
                self._cached_real_bt = real_bt
            if bt_radio_status is not None:
                self._cached_real_bt_radio_status = bt_radio_status
                self._cached_real_bt_radio_iid = bt_radio_iid
        except Exception as e:
            logger.debug(f"Erreur rafraîchissement PnP devices: {e}")
        self._last_pnp_fetch_time = time.time()

    def _set_active_device(self, dev_id: str, direction: str):
        if direction == "input":
            self._active_input_id = dev_id
            if self._cached_real_inputs:
                for d in self._cached_real_inputs:
                    d["active"] = (d["id"] == dev_id or d["name"] == dev_id)
            for d in self._sim_input_devices:
                d["active"] = (d["id"] == dev_id or d["name"] == dev_id)
        else:
            self._active_output_id = dev_id
            if self._cached_real_outputs:
                for d in self._cached_real_outputs:
                    d["active"] = (d["id"] == dev_id or d["name"] == dev_id)
            for d in self._sim_output_devices:
                d["active"] = (d["id"] == dev_id or d["name"] == dev_id)
            # Le contrôleur de volume mis en cache pointe vers l'ANCIEN périphérique de
            # sortie par défaut — invalidé ici pour forcer sa reconstruction sur le nouveau.
            self._invalidate_volume_controller()

        if IS_WINDOWS and dev_id:
            try:
                import subprocess
                ps_cmd = f"Get-PnpDevice -InstanceId '{dev_id}' -ErrorAction SilentlyContinue | Enable-PnpDevice -Confirm:$false -ErrorAction SilentlyContinue"
                subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, timeout=2)
            except Exception as e:
                logger.debug(f"Attempt set default audio endpoint PnP: {e}")

    def _set_bluetooth_connected(self, dev_id: str, connected: bool):
        if self._cached_real_bt:
            for d in self._cached_real_bt:
                if d["id"] == dev_id or d["name"] == dev_id:
                    d["connected"] = connected
                    break
        for d in self._bluetooth_devices:
            if d["id"] == dev_id or d["name"] == dev_id:
                d["connected"] = connected
                break

        if IS_WINDOWS and dev_id and not dev_id.startswith("bt_"):
            try:
                import subprocess
                action = "Enable-PnpDevice" if connected else "Disable-PnpDevice"
                ps_cmd = f"Get-PnpDevice -InstanceId '{dev_id}' -ErrorAction SilentlyContinue | {action} -Confirm:$false -ErrorAction SilentlyContinue"
                subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, timeout=3)
            except Exception as e:
                logger.debug(f"PnP Bluetooth connect/disconnect attempt: {e}")

    def _get_output_devices_list(self) -> list:
        real_out = self._cached_real_outputs
        if real_out:
            for d in real_out:
                d["active"] = (d["id"] == self._active_output_id or d["name"] == self._active_output_id)
            if not any(d["active"] for d in real_out) and real_out:
                real_out[0]["active"] = True
                self._active_output_id = real_out[0]["id"]
            return real_out

        for d in self._sim_output_devices:
            d["active"] = (d["id"] == self._active_output_id or d["name"] == self._active_output_id)
        return self._sim_output_devices

    def _get_input_devices_list(self) -> list:
        real_in = self._cached_real_inputs
        if real_in:
            for d in real_in:
                d["active"] = (d["id"] == self._active_input_id or d["name"] == self._active_input_id)
            if not any(d["active"] for d in real_in) and real_in:
                real_in[0]["active"] = True
                self._active_input_id = real_in[0]["id"]
            return real_in

        for d in self._sim_input_devices:
            d["active"] = (d["id"] == self._active_input_id or d["name"] == self._active_input_id)
        return self._sim_input_devices

    def _get_bluetooth_devices_list(self) -> list:
        # Ne forcer connected: False que si le radio réel est explicitement confirmé désactivé (is False),
        # ou en mode simulation (status is None) si self._bluetooth_enabled est False.
        if self._cached_real_bt_radio_status is False or (self._cached_real_bt_radio_status is None and not self._bluetooth_enabled):
            if self._cached_real_bt:
                for d in self._cached_real_bt:
                    d["connected"] = False
                return self._cached_real_bt
            for d in self._bluetooth_devices:
                d["connected"] = False
            return self._bluetooth_devices

        real_bt = self._cached_real_bt
        if real_bt:
            return real_bt

        return self._bluetooth_devices

    # ── État complet ──────────────────────────────────────────────────────────

    async def get_full_state(self) -> dict:
        import time
        # Lance le rafraîchissement PnP en arrière-plan sans bloquer get_full_state (rafraîchissement asynchrone toutes les 30s)
        if time.time() - self._last_pnp_fetch_time > 30.0:
            self._last_pnp_fetch_time = time.time()
            asyncio.create_task(asyncio.to_thread(self._refresh_pnp_devices_sync))

        if PYCAW_AVAILABLE:
            loop = asyncio.get_event_loop()
            state = await loop.run_in_executor(None, self._read_windows_state_sync)
        else:
            state = {
                "type": "audio.state",
                "master_volume": self._sim_volume,
                "muted": self._sim_muted,
                "applications": self._sim_apps.copy(),
                "source": "simulation",
            }

        state["output_devices"] = self._get_output_devices_list()
        state["input_devices"] = self._get_input_devices_list()

        # Utilise l'état réel du radio Bluetooth Windows si disponible (_cached_real_bt_radio_status is not None),
        # sinon retombe sur self._bluetooth_enabled qui ne sert plus que de repli pour la simulation (non-Windows).
        bt_enabled = self._cached_real_bt_radio_status if self._cached_real_bt_radio_status is not None else self._bluetooth_enabled

        state["bluetooth"] = {
            "enabled": bt_enabled,
            "devices": self._get_bluetooth_devices_list()
        }
        return state

    def _read_windows_state_sync(self) -> dict:
        """Lecture synchrone de l'état audio — appelée depuis un thread executor.
        CoInitialize est requis car les threads executor n'ont pas de contexte COM.
        """
        CoInitialize()
        try:
            master_vol, is_muted = self._with_volume_controller(
                lambda vc: (vc.GetMasterVolumeLevelScalar(), bool(vc.GetMute()))
            )

            sessions = AudioUtilities.GetAllSessions()
            apps = []
            seen_names = set()
            excluded_names = {"system", "system audio", "windows audio", "audiodg", "idle", "host", "volume principal"}

            for session in sessions:
                try:
                    if session.Process and session.Process.name():
                        pname_raw = session.Process.name().replace(".exe", "")
                        pname = pname_raw.capitalize()
                        pname_lower = pname_raw.lower()

                        if pname_lower in excluded_names:
                            continue

                        # Déduplication : 1 seule entrée par nom d'application
                        if pname_lower in seen_names:
                            continue
                        seen_names.add(pname_lower)

                        vol = session.SimpleAudioVolume
                        apps.append({
                            "name": pname,
                            "pid": session.Process.pid,
                            "volume": round(vol.GetMasterVolume(), 2),
                            "muted": bool(vol.GetMute()),
                        })
                except Exception:
                    continue

            return {
                "type": "audio.state",
                "master_volume": round(master_vol, 2),
                "muted": is_muted,
                "applications": apps,
                "source": "windows",
            }

        except Exception as e:
            logger.error(f"Erreur lecture audio Windows : {e}")
            return {"type": "audio.state", "error": str(e), "source": "windows"}
        finally:
            CoUninitialize()

    # ── Commandes audio ───────────────────────────────────────────────────────

    async def handle_command(self, data: dict) -> dict:
        command = data.get("command", "")

        if PYCAW_AVAILABLE:
            loop = asyncio.get_event_loop()
            try:
                return await loop.run_in_executor(
                    None, self._run_windows_audio_command_sync, command, data
                )
            except Exception as e:
                logger.error(f"Erreur commande audio Windows : {e}")
                return {"type": "error", "message": str(e)}

        return await self._simulate_audio_command(command, data)

    def _run_windows_audio_command_sync(self, command: str, data: dict) -> dict:
        """Exécution synchrone des commandes pycaw — dans un thread executor.
        CoInitialize est requis car les threads executor n'ont pas de contexte COM.
        """
        CoInitialize()
        try:
            if command == "audio.volume.set":
                value = max(0.0, min(1.0, float(data.get("value", 0.5))))
                self._with_volume_controller(lambda vc: vc.SetMasterVolumeLevelScalar(value, None))
                return {"type": "audio.volume.updated", "value": value}

            elif command == "audio.mute.toggle":
                current_mute = self._with_volume_controller(lambda vc: vc.GetMute())
                self._with_volume_controller(lambda vc: vc.SetMute(not current_mute, None))
                return {"type": "audio.mute.updated", "muted": not current_mute}

            elif command == "audio.app.volume.set":
                pid = data.get("pid")
                app_name = data.get("name") or data.get("app") or data.get("appName")
                value = max(0.0, min(1.0, float(data.get("value", 0.5))))

                if app_name and str(app_name).lower() in ("master", "volume principal"):
                    try:
                        self._with_volume_controller(lambda vc: vc.SetMasterVolumeLevelScalar(value, None))
                        return {"type": "audio.volume.updated", "value": value}
                    except Exception as e:
                        return {"type": "error", "message": str(e)}

                sessions = AudioUtilities.GetAllSessions()
                updated = False
                for session in sessions:
                    try:
                        if session.Process:
                            spid = session.Process.pid
                            pname = session.Process.name().replace(".exe", "") if session.Process.name() else ""

                            pid_match = (pid is not None and str(spid) == str(pid))
                            name_match = False
                            if app_name:
                                target = str(app_name).lower().replace(".exe", "").strip()
                                proc = pname.lower().strip()
                                if target and (target in proc or proc in target):
                                    name_match = True

                            if pid_match or name_match:
                                session.SimpleAudioVolume.SetMasterVolume(value, None)
                                updated = True
                    except Exception:
                        continue
                return {"type": "audio.app.volume.updated", "pid": pid, "name": app_name, "value": value}

            elif command in ("audio.app.mute.toggle", "audio.app.mute.set", "audio.mute.set"):
                pid = data.get("pid")
                app_name = data.get("name") or data.get("app") or data.get("appKey") or data.get("appName")
                requested_muted = data.get("muted")

                if (not pid and not app_name) or (app_name and str(app_name).lower() in ("master", "volume principal", "général", "general")):
                    if requested_muted is not None:
                        new_mute = bool(requested_muted)
                    else:
                        new_mute = not bool(self._with_volume_controller(lambda vc: vc.GetMute()))
                    self._with_volume_controller(lambda vc: vc.SetMute(new_mute, None))
                    return {"type": "audio.mute.updated", "muted": new_mute}

                target = str(app_name).lower().replace(".exe", "").strip() if app_name else ""
                if target in ("musique", "music"):
                    targets = ["deezer", "spotify", "music", "musique"]
                elif target in ("vocal", "discord"):
                    targets = ["discord", "teams", "skype", "vocal"]
                elif target in ("jeu", "simu"):
                    targets = ["game", "jeu", "simu", "iracing", "assetto", "f1_23", "f1_24", "rfactor"]
                else:
                    targets = [target] if target else []

                sessions = AudioUtilities.GetAllSessions()
                final_muted = None
                for session in sessions:
                    try:
                        if session.Process:
                            spid = session.Process.pid
                            pname = session.Process.name().replace(".exe", "").lower().strip() if session.Process.name() else ""

                            pid_match = (pid is not None and str(spid) == str(pid))
                            name_match = False
                            if targets:
                                for t in targets:
                                    if t and (t in pname or pname in t):
                                        name_match = True
                                        break

                            if pid_match or name_match:
                                vol = session.SimpleAudioVolume
                                if requested_muted is not None:
                                    new_mute = bool(requested_muted)
                                else:
                                    new_mute = not bool(vol.GetMute())
                                vol.SetMute(new_mute, None)
                                final_muted = new_mute
                    except Exception:
                        continue
                if final_muted is None and requested_muted is not None:
                    final_muted = bool(requested_muted)
                return {"type": "audio.app.mute.updated", "pid": pid, "appKey": app_name, "muted": bool(final_muted)}

            elif command == "audio.device.set_default":
                dev_id = data.get("device_id", "")
                direction = data.get("direction", "output")
                self._set_active_device(dev_id, direction)
                logger.info(f"Périphérique audio par défaut défini ({direction}) : {dev_id}")
                return {"type": "audio.device.updated", "device_id": dev_id, "direction": direction}

            elif command == "bluetooth.toggle":
                import subprocess
                # 1. Détermine l'état cible souhaité
                req_enabled = data.get("enabled")
                current_enabled = self._cached_real_bt_radio_status if self._cached_real_bt_radio_status is not None else self._bluetooth_enabled
                target_enabled = bool(req_enabled) if req_enabled is not None else not current_enabled

                # 2. Récupère l'InstanceId du radio et tente Enable-PnpDevice / Disable-PnpDevice sur Windows
                radio_iid = self._cached_real_bt_radio_iid
                if not radio_iid:
                    _, radio_iid = _get_windows_bluetooth_radio_status()

                admin_error = False
                if radio_iid:
                    action = "Enable-PnpDevice" if target_enabled else "Disable-PnpDevice"
                    ps_cmd = f"Get-PnpDevice -InstanceId '{radio_iid}' -ErrorAction SilentlyContinue | {action} -Confirm:$false"
                    try:
                        res = subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, encoding="utf-8", timeout=4)
                        if res.returncode != 0 or "Access is denied" in res.stderr or "accès refusé" in res.stderr.lower():
                            admin_error = True
                            logger.warning("Impossible de modifier l'état du Bluetooth : droits administrateur requis")
                    except Exception as e:
                        admin_error = True
                        logger.warning(f"Impossible de modifier l'état du Bluetooth : droits administrateur requis ({e})")
                else:
                    logger.warning("Impossible de modifier l'état du Bluetooth : adaptateur radio non trouvé")

                # 3. Interroge immédiatement le statut réel pour renvoyer la vérité terrain
                real_status, real_iid = _get_windows_bluetooth_radio_status()
                if real_status is not None:
                    self._cached_real_bt_radio_status = real_status
                    self._cached_real_bt_radio_iid = real_iid
                    final_enabled = real_status
                else:
                    self._bluetooth_enabled = target_enabled
                    final_enabled = target_enabled

                if not final_enabled:
                    if self._cached_real_bt:
                        for d in self._cached_real_bt:
                            d["connected"] = False
                    for d in self._bluetooth_devices:
                        d["connected"] = False

                logger.info(f"Bluetooth state: {'activé' if final_enabled else 'désactivé'}")
                if admin_error and final_enabled != target_enabled:
                    return {
                        "type": "error",
                        "message": "Impossible de modifier l'état du Bluetooth : droits administrateur requis sur Windows.",
                        "enabled": final_enabled
                    }
                return {"type": "bluetooth.updated", "enabled": final_enabled}

            elif command in ("bluetooth.connect", "bluetooth.disconnect"):
                dev_id = data.get("device_id", "")
                target_state = (command == "bluetooth.connect")
                self._set_bluetooth_connected(dev_id, target_state)
                logger.info(f"Appareil Bluetooth {dev_id} {'connecté' if target_state else 'déconnecté'}")
                return {"type": "bluetooth.updated", "device_id": dev_id, "connected": target_state}

            elif command == "bluetooth.scan":
                logger.info("Recherche d'appareils Bluetooth lancée")
                self._refresh_pnp_devices_sync()
                return {"type": "bluetooth.scan.completed"}

            else:
                return {"type": "error", "message": f"Commande audio inconnue : {command}"}

        except Exception as e:
            logger.error(f"Erreur pycaw sync : {e}")
            return {"type": "error", "message": str(e)}
        finally:
            CoUninitialize()

    async def _simulate_audio_command(self, command: str, data: dict) -> dict:
        if command == "audio.volume.set":
            value = max(0.0, min(1.0, float(data.get("value", 0.5))))
            self._sim_volume = value
            return {"type": "audio.volume.updated", "value": value}

        elif command == "audio.mute.toggle":
            self._sim_muted = not self._sim_muted
            return {"type": "audio.mute.updated", "muted": self._sim_muted}

        elif command == "audio.app.volume.set":
            pid = data.get("pid")
            app_name = data.get("name") or data.get("app") or data.get("appName")
            value = max(0.0, min(1.0, float(data.get("value", 0.5))))
            if app_name and str(app_name).lower() in ("master", "volume principal"):
                self._sim_volume = value
                return {"type": "audio.volume.updated", "value": value}
            for app in self._sim_apps:
                spid = app.get("pid")
                sname = app.get("name", "")
                if (pid is not None and str(spid) == str(pid)) or (app_name and str(sname).lower() in str(app_name).lower()):
                    app["volume"] = value
            return {"type": "audio.app.volume.updated", "pid": pid, "name": app_name, "value": value}

        elif command in ("audio.app.mute.toggle", "audio.app.mute.set", "audio.mute.set"):
            pid = data.get("pid")
            app_name = data.get("name") or data.get("app") or data.get("appKey") or data.get("appName")
            requested_muted = data.get("muted")

            if (not pid and not app_name) or (app_name and str(app_name).lower() in ("master", "volume principal", "général", "general")):
                if requested_muted is not None:
                    self._sim_muted = bool(requested_muted)
                else:
                    self._sim_muted = not self._sim_muted
                return {"type": "audio.mute.updated", "muted": self._sim_muted}

            new_mute = bool(requested_muted) if requested_muted is not None else True
            for app in self._sim_apps:
                spid = app.get("pid")
                sname = app.get("name", "")
                if (pid is not None and str(spid) == str(pid)) or (app_name and str(sname).lower() in str(app_name).lower()):
                    if requested_muted is not None:
                        app["muted"] = bool(requested_muted)
                    else:
                        app["muted"] = not app.get("muted", False)
                    new_mute = app["muted"]
            return {"type": "audio.app.mute.updated", "pid": pid, "appKey": app_name, "muted": new_mute}

        elif command == "audio.device.set_default":
            dev_id = data.get("device_id", "")
            direction = data.get("direction", "output")
            self._set_active_device(dev_id, direction)
            return {"type": "audio.device.updated", "device_id": dev_id, "direction": direction}

        elif command == "bluetooth.toggle":
            req_enabled = data.get("enabled")
            if req_enabled is not None:
                self._bluetooth_enabled = bool(req_enabled)
            else:
                self._bluetooth_enabled = not self._bluetooth_enabled
            if not self._bluetooth_enabled:
                if self._cached_real_bt:
                    for d in self._cached_real_bt:
                        d["connected"] = False
                for d in self._bluetooth_devices:
                    d["connected"] = False
            return {"type": "bluetooth.updated", "enabled": self._bluetooth_enabled}

        elif command in ("bluetooth.connect", "bluetooth.disconnect"):
            dev_id = data.get("device_id", "")
            target_state = (command == "bluetooth.connect")
            self._set_bluetooth_connected(dev_id, target_state)
            return {"type": "bluetooth.updated", "device_id": dev_id, "connected": target_state}

        elif command == "bluetooth.scan":
            self._refresh_pnp_devices_sync()
            return {"type": "bluetooth.scan.completed"}

        return {"type": "error", "message": f"Commande audio inconnue : {command}"}


# Instance unique partagée dans toute l'application
windows_audio_service = WindowsAudioService()
