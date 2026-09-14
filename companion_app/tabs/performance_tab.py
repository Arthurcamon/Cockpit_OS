"""
Onglet Performance — CPU/RAM du PROCESSUS SERVEUR uniquement
(psutil.Process(pid) ciblé sur le PID géré par le ServerController partagé
avec l'onglet Serveur, voir app.py) — jamais de données PC-wide ici, ça
reste une responsabilité de main.py pour la tablette
(services/system_monitor.py). Rafraîchissement toutes les 2 secondes.

Couleurs alignées sur la palette Setup de la tablette (services/
system_monitor.py::COLOR_CPU/COLOR_RAM) pour rester visuellement cohérent
entre les deux apps du même produit.
"""

import time

import customtkinter as ctk
import psutil

from companion_app import theme
from companion_app.server_control import ServerController

POLL_MS = 2000
COLOR_CPU = "#5ce1e6"
COLOR_RAM = "#6f97ff"


def _build_metric_card(parent: ctk.CTkFrame, title: str, color: str) -> dict:
    card = ctk.CTkFrame(parent, fg_color=theme.SURFACE_2, corner_radius=10)
    ctk.CTkLabel(card, text=title, font=theme.font(13, "bold"), text_color=theme.TEXT_SECONDARY).pack(anchor="w", padx=16, pady=(14, 4))
    value_label = ctk.CTkLabel(card, text="—", font=theme.font(30, "bold"), text_color=theme.TEXT_PRIMARY)
    value_label.pack(anchor="w", padx=16)
    sub_label = ctk.CTkLabel(card, text="", font=theme.font(12), text_color=theme.TEXT_TERTIARY)
    sub_label.pack(anchor="w", padx=16, pady=(2, 10))
    bar = ctk.CTkProgressBar(card, progress_color=color, fg_color=theme.SURFACE_1, height=8, corner_radius=4)
    bar.set(0)
    bar.pack(fill="x", padx=16, pady=(0, 16))
    return {"card": card, "value": value_label, "sub": sub_label, "bar": bar}


def build(parent: ctk.CTkFrame, controller: ServerController) -> None:
    tracked = {"pid": None, "proc": None, "started_at": None}

    parent.grid_columnconfigure(0, weight=1)
    parent.grid_columnconfigure(1, weight=1)
    parent.grid_rowconfigure(0, weight=1)

    empty_wrap = ctk.CTkFrame(parent, fg_color="transparent")
    ctk.CTkLabel(empty_wrap, text="Performance", font=theme.font(20, "bold"), text_color=theme.TEXT_PRIMARY).pack(pady=(0, 6))
    ctk.CTkLabel(
        empty_wrap, text="Serveur arrêté — aucune donnée à afficher", font=theme.font(13), text_color=theme.TEXT_TERTIARY,
    ).pack()
    empty_wrap.grid(row=0, column=0, columnspan=2)

    cpu = _build_metric_card(parent, "CPU — processus serveur", COLOR_CPU)
    ram = _build_metric_card(parent, "Mémoire — processus serveur", COLOR_RAM)

    info_label = ctk.CTkLabel(parent, text="", font=theme.font(12), text_color=theme.TEXT_TERTIARY)

    def show_empty() -> None:
        cpu["card"].grid_remove()
        ram["card"].grid_remove()
        info_label.grid_remove()
        empty_wrap.grid(row=0, column=0, columnspan=2)

    def show_metrics() -> None:
        empty_wrap.grid_remove()
        cpu["card"].grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        ram["card"].grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        info_label.grid(row=1, column=0, columnspan=2, sticky="w", pady=(10, 0))

    def ensure_tracking_current_pid() -> bool:
        """(Ré)initialise le suivi psutil si le PID du serveur a changé
        (premier démarrage, ou redémarrage — nouveau process = nouveau
        PID). Retourne False si aucun process valide n'est disponible."""
        pid = controller.pid
        if pid is None:
            tracked["pid"] = None
            tracked["proc"] = None
            return False
        if pid != tracked["pid"]:
            try:
                proc = psutil.Process(pid)
                proc.cpu_percent(interval=None)  # amorce le calcul delta
                tracked["pid"] = pid
                tracked["proc"] = proc
                tracked["started_at"] = time.time()
            except psutil.NoSuchProcess:
                tracked["pid"] = None
                tracked["proc"] = None
                return False
        return tracked["proc"] is not None

    def poll() -> None:
        if controller.state != "running" or not ensure_tracking_current_pid():
            show_empty()
            parent.after(POLL_MS, poll)
            return

        try:
            proc = tracked["proc"]
            cpu_pct = proc.cpu_percent(interval=None)
            mem_info = proc.memory_info()
            mem_mb = mem_info.rss / (1024 ** 2)
            mem_pct = proc.memory_percent()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            show_empty()
            parent.after(POLL_MS, poll)
            return

        show_metrics()
        cpu["value"].configure(text=f"{cpu_pct:.1f} %".replace(".", ","))
        cpu["sub"].configure(text=f"{psutil.cpu_count() or 1} cœur(s) logique(s) sur la machine")
        cpu["bar"].set(min(1.0, cpu_pct / 100))

        ram["value"].configure(text=f"{mem_mb:.0f} Mo".replace(".", ","))
        ram["sub"].configure(text=f"{mem_pct:.1f} % de la RAM système".replace(".", ","))
        ram["bar"].set(min(1.0, mem_pct / 100))

        uptime_s = int(time.time() - (tracked["started_at"] or time.time()))
        mins, secs = divmod(uptime_s, 60)
        hours, mins = divmod(mins, 60)
        uptime_str = f"{hours}h{mins:02d}m{secs:02d}s" if hours else f"{mins}m{secs:02d}s"
        info_label.configure(text=f"PID {tracked['pid']} · actif depuis {uptime_str}")

        parent.after(POLL_MS, poll)

    show_empty()
    parent.after(50, poll)  # premier relevé rapide, cadence normale (POLL_MS) ensuite
