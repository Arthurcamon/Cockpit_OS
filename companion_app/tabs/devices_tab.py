"""
Onglet Appareils connectés — liste complète lue depuis GET /api/devices,
avec révocation réelle (POST /api/devices/{id}/kick). La révocation n'est
JAMAIS déclenchée directement au clic — une confirmation explicite est
toujours affichée avant (voir le plan, volet B/étape 10).
"""

import threading
import tkinter.messagebox as messagebox

import customtkinter as ctk
import httpx

from companion_app import theme
from companion_app.server_control import ServerController
from config import settings

POLL_MS = 5000


def _format_duration(seconds) -> str:
    secs = int(seconds or 0)
    mins, s = divmod(secs, 60)
    hours, mins = divmod(mins, 60)
    if hours:
        return f"{hours}h{mins:02d}m{s:02d}s"
    if mins:
        return f"{mins}m{s:02d}s"
    return f"{s}s"


def build(parent: ctk.CTkFrame, controller: ServerController) -> None:
    parent.grid_columnconfigure(0, weight=1)
    parent.grid_rowconfigure(1, weight=1)

    header = ctk.CTkFrame(parent, fg_color="transparent")
    header.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    ctk.CTkLabel(header, text="Appareils connectés", font=theme.font(18, "bold"), text_color=theme.TEXT_PRIMARY).pack(side="left")

    list_frame = ctk.CTkScrollableFrame(parent, fg_color=theme.SURFACE_2, corner_radius=10)
    list_frame.grid(row=1, column=0, sticky="nsew")

    def render(devices, error: str = None) -> None:
        for child in list_frame.winfo_children():
            child.destroy()
        if error:
            ctk.CTkLabel(list_frame, text=error, font=theme.font(13), text_color=theme.TEXT_TERTIARY).pack(pady=24)
            return
        if not devices:
            ctk.CTkLabel(list_frame, text="Aucun appareil connecté", font=theme.font(13), text_color=theme.TEXT_TERTIARY).pack(pady=24)
            return
        for d in devices:
            _build_row(list_frame, d, do_kick)

    def do_kick(device_id: str, ip: str) -> None:
        if not messagebox.askyesno(
            "Déconnecter cet appareil ?",
            f"Déconnecter l'appareil {ip} ?\nIl devra recharger la page pour se reconnecter.",
        ):
            return

        def kick_bg() -> None:
            try:
                httpx.post(
                    f"http://127.0.0.1:{settings.PORT}/api/devices/{device_id}/kick",
                    params={"token": settings.AUTH_TOKEN}, timeout=3.0,
                )
            except Exception:
                pass
            parent.after(0, fetch)

        threading.Thread(target=kick_bg, daemon=True).start()

    def fetch_bg() -> None:
        try:
            resp = httpx.get(
                f"http://127.0.0.1:{settings.PORT}/api/devices",
                params={"token": settings.AUTH_TOKEN}, timeout=3.0,
            )
            resp.raise_for_status()
            devices = resp.json()
            parent.after(0, lambda: render(devices))
        except Exception:
            parent.after(0, lambda: render(None, error="Appareils indisponibles"))

    def fetch() -> None:
        if controller.state == "running":
            threading.Thread(target=fetch_bg, daemon=True).start()
        else:
            render(None, error="Serveur arrêté")

    def poll() -> None:
        fetch()
        parent.after(POLL_MS, poll)

    parent.after(50, poll)  # premier relevé rapide, cadence normale (POLL_MS) ensuite


def _build_row(list_frame: ctk.CTkScrollableFrame, device: dict, do_kick) -> None:
    row = ctk.CTkFrame(list_frame, fg_color=theme.SURFACE_1, corner_radius=8)
    row.pack(fill="x", pady=4, padx=6)

    info = ctk.CTkFrame(row, fg_color="transparent")
    info.pack(side="left", fill="both", expand=True, padx=(14, 10), pady=10)
    ctk.CTkLabel(info, text=device.get("ip", "?"), font=theme.font(14, "bold"), text_color=theme.TEXT_PRIMARY, anchor="w").pack(anchor="w")
    ctk.CTkLabel(
        info, text=f"Connecté depuis {_format_duration(device.get('connected_seconds'))}",
        font=theme.font(11), text_color=theme.TEXT_TERTIARY, anchor="w",
    ).pack(anchor="w")

    ctk.CTkButton(
        row, text="Déconnecter", fg_color=theme.DANGER, hover_color=theme.DANGER_HOVER, text_color=theme.TEXT_PRIMARY,
        font=theme.font(12, "bold"), width=110,
        command=lambda: do_kick(device.get("id"), device.get("ip", "?")),
    ).pack(side="right", padx=12)
