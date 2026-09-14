"""
Cockpit OS — App compagnon : contrôleur du processus serveur (main.py).

Lance/arrête/redémarre main.py en sous-processus SANS fenêtre console
visible (CREATE_NO_WINDOW — indispensable ici : sans ce flag, lancer un
script Python depuis une app elle-même dépourvue de console peut quand
même faire apparaître une fenêtre console pour l'enfant). stdout+stderr
sont fusionnés (stderr=STDOUT) et capturés en tâche de fond dans une file
thread-safe consommée par l'UI (CTkTextbox de server_tab.py) — main.py
journalise via logging.StreamHandler(sys.stdout) (voir core/logger.py) et
Uvicorn fait de même par défaut, donc tout ce qui intéresse l'utilisateur
transite par stdout ; stderr est quand même fusionné pour ne perdre aucune
trace de crash (exception non interceptée, erreur de port déjà utilisé...).

État exposé : "stopped" | "running" — un seul thread (_watch_process) fait
autorité sur la transition vers "stopped", que l'arrêt vienne d'un appel à
stop() ou d'un crash, pour éviter toute course entre plusieurs threads qui
tenteraient chacun de décider de l'état.
"""

import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MAIN_PY = PROJECT_ROOT / "main.py"

# Windows uniquement — indispensable pour ne jamais laisser apparaître de
# fenêtre console pour le sous-processus serveur.
CREATE_NO_WINDOW = 0x08000000


class ServerController:
    def __init__(self, on_state_change: Optional[Callable[[str], None]] = None):
        self._process: Optional[subprocess.Popen] = None
        self._pending_restart = False
        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.state = "stopped"  # "stopped" | "running"
        self._on_state_change = on_state_change

    def _set_state(self, state: str) -> None:
        self.state = state
        if self._on_state_change:
            self._on_state_change(state)

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    @property
    def pid(self) -> Optional[int]:
        return self._process.pid if self._process else None

    def start(self) -> None:
        if self.is_running:
            return

        self.log_queue.put(f"--- Lancement de {MAIN_PY.name} ---")
        try:
            self._process = subprocess.Popen(
                [sys.executable, "-u", str(MAIN_PY)],
                cwd=str(PROJECT_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=CREATE_NO_WINDOW,
            )
        except OSError as e:
            self.log_queue.put(f"--- Échec du lancement : {e} ---")
            return

        self._set_state("running")
        threading.Thread(target=self._read_output, daemon=True).start()
        threading.Thread(target=self._watch_process, args=(self._process,), daemon=True).start()

    def _read_output(self) -> None:
        proc = self._process
        if proc is None or proc.stdout is None:
            return
        for line in proc.stdout:
            self.log_queue.put(line.rstrip("\n"))

    def _watch_process(self, proc: subprocess.Popen) -> None:
        """Bloque jusqu'à la fin du process — seul endroit qui décide de la
        transition vers "stopped", que ce soit après un stop() volontaire ou
        un crash (port déjà utilisé, exception non interceptée...)."""
        exit_code = proc.wait()
        self.log_queue.put(f"--- Serveur arrêté (code {exit_code}) ---")
        if self._process is proc:
            self._process = None
        self._set_state("stopped")
        if self._pending_restart:
            self._pending_restart = False
            self.start()

    def stop(self) -> None:
        if not self.is_running:
            return
        self.log_queue.put("--- Arrêt du serveur demandé ---")
        try:
            # TerminateProcess sur Windows — immédiat et inconditionnel (ne
            # déclenche PAS les handlers signal.signal(SIGTERM/SIGINT, ...)
            # de main.py, qui exigent un vrai signal console — impossible à
            # délivrer proprement à un process lancé sans console/CREATE_NO_
            # WINDOW). Pas de risque de perte de données : le serveur n'a
            # aucun état non persistant critique à flusher.
            self._process.terminate()
        except Exception as e:
            self.log_queue.put(f"--- Erreur à l'arrêt : {e} ---")

    def restart(self) -> None:
        if not self.is_running:
            self.start()
            return
        self._pending_restart = True
        self.stop()  # la reprise se fait dans _watch_process une fois le process terminé
