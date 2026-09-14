"""
Onglet Serveur — lancement/arrêt/redémarrage de main.py (sans fenêtre
console), logs en direct, case "Lancer au démarrage de Windows", QR code
de connexion, liste des appareils connectés en lecture seule (la
révocation se fait depuis l'onglet Appareils connectés, étape 10).
"""

import threading

import customtkinter as ctk
import httpx
import qrcode
from PIL import Image

from companion_app import net_utils, startup_shortcut, theme
from companion_app.server_control import ServerController
from config import settings

LOG_POLL_MS = 150
DEVICES_POLL_MS = 5000
MAX_LOG_LINES = 2000


def build(parent: ctk.CTkFrame, controller: ServerController) -> None:
    last_seen_state = {"value": controller.state}

    parent.grid_columnconfigure(0, weight=3)
    parent.grid_columnconfigure(1, weight=1)
    parent.grid_rowconfigure(0, weight=1)

    # ── Colonne gauche : état/contrôles + logs ─────────────────────────────
    left = ctk.CTkFrame(parent, fg_color="transparent")
    left.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
    left.grid_columnconfigure(0, weight=1)
    left.grid_rowconfigure(1, weight=1)

    control_row = ctk.CTkFrame(left, fg_color="transparent")
    control_row.grid(row=0, column=0, sticky="ew", pady=(0, 10))

    status_dot = ctk.CTkLabel(control_row, text="●", font=theme.font(16), text_color=theme.TEXT_TERTIARY, width=20)
    status_dot.pack(side="left", padx=(4, 4))
    status_label = ctk.CTkLabel(control_row, text="Arrêté", font=theme.font(14, "bold"), text_color=theme.TEXT_SECONDARY)
    status_label.pack(side="left", padx=(0, 20))

    def make_button(text, command, fg=theme.ACCENT, hover=theme.ACCENT_HOVER):
        return ctk.CTkButton(
            control_row, text=text, command=command, fg_color=fg, hover_color=hover,
            text_color=theme.TEXT_PRIMARY, font=theme.font(13, "bold"), width=110, corner_radius=8,
        )

    btn_start = make_button("Lancer", lambda: controller.start())
    btn_restart = make_button("Redémarrer", lambda: controller.restart(), fg=theme.SURFACE_2, hover=theme.SURFACE_2_HOVER)
    btn_stop = make_button("Arrêter", lambda: controller.stop(), fg=theme.DANGER, hover=theme.DANGER_HOVER)
    for b in (btn_start, btn_restart, btn_stop):
        b.pack(side="left", padx=4)

    logs_box = ctk.CTkTextbox(
        left, fg_color=theme.SURFACE_2, text_color=theme.TEXT_SECONDARY,
        font=ctk.CTkFont(family="Consolas", size=12), corner_radius=8, wrap="none",
    )
    logs_box.grid(row=1, column=0, sticky="nsew")
    logs_box.configure(state="disabled")

    def append_log(line: str) -> None:
        logs_box.configure(state="normal")
        logs_box.insert("end", line + "\n")
        # Purge des lignes les plus anciennes au-delà de MAX_LOG_LINES —
        # une session serveur en voiture peut tourner des heures, pas de
        # croissance mémoire non bornée pour un simple visualiseur de logs.
        line_count = int(logs_box.index("end-1c").split(".")[0])
        if line_count > MAX_LOG_LINES:
            logs_box.delete("1.0", f"{line_count - MAX_LOG_LINES}.0")
        logs_box.see("end")
        logs_box.configure(state="disabled")

    # ── Colonne droite : QR code, démarrage Windows, appareils ─────────────
    right = ctk.CTkFrame(parent, fg_color="transparent")
    right.grid(row=0, column=1, sticky="nsew")
    right.grid_columnconfigure(0, weight=1)

    qr_card = ctk.CTkFrame(right, fg_color=theme.SURFACE_2, corner_radius=10)
    qr_card.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    ctk.CTkLabel(qr_card, text="Connexion tablette", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(pady=(12, 6))

    connection_url = f"http://{net_utils.get_local_ip()}:{settings.PORT}/?token={settings.AUTH_TOKEN}"
    qr_pil = qrcode.make(connection_url, border=2).get_image().convert("RGB")
    qr_image = ctk.CTkImage(light_image=qr_pil, dark_image=qr_pil, size=(180, 180))
    ctk.CTkLabel(qr_card, image=qr_image, text="").pack(padx=16)

    url_box = ctk.CTkTextbox(qr_card, height=44, fg_color=theme.SURFACE_1, text_color=theme.TEXT_TERTIARY, font=theme.font(11), wrap="char")
    url_box.pack(fill="x", padx=12, pady=(8, 12))
    url_box.insert("1.0", connection_url)
    url_box.configure(state="disabled")

    # ── Lancer au démarrage de Windows ──────────────────────────────────────
    startup_var = ctk.BooleanVar(value=startup_shortcut.is_enabled())

    def on_toggle_startup() -> None:
        try:
            if startup_var.get():
                startup_shortcut.enable()
            else:
                startup_shortcut.disable()
        except Exception as e:
            # Ne jamais échouer silencieusement (ex: droits insuffisants sur
            # le dossier Démarrage) — remet la case dans son état réel et
            # affiche l'erreur.
            startup_var.set(startup_shortcut.is_enabled())
            append_log(f"--- Échec de la mise à jour du raccourci de démarrage : {e} ---")

    ctk.CTkCheckBox(
        right, text="Lancer au démarrage de Windows", variable=startup_var, command=on_toggle_startup,
        font=theme.font(12), text_color=theme.TEXT_SECONDARY, fg_color=theme.ACCENT, hover_color=theme.ACCENT_HOVER,
        border_color=theme.TEXT_TERTIARY,
    ).grid(row=1, column=0, sticky="w", pady=(0, 14))

    # ── Appareils connectés (lecture seule) ─────────────────────────────────
    devices_card = ctk.CTkFrame(right, fg_color=theme.SURFACE_2, corner_radius=10)
    devices_card.grid(row=2, column=0, sticky="nsew")
    right.grid_rowconfigure(2, weight=1)
    ctk.CTkLabel(devices_card, text="Appareils connectés", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(anchor="w", padx=12, pady=(10, 4))
    devices_list = ctk.CTkScrollableFrame(devices_card, fg_color="transparent")
    devices_list.pack(fill="both", expand=True, padx=8, pady=(0, 8))
    devices_empty_label = ctk.CTkLabel(devices_list, text="Serveur arrêté", font=theme.font(12), text_color=theme.TEXT_TERTIARY)
    devices_empty_label.pack(pady=8)

    def render_devices(devices: list[dict] | None, error: str | None = None) -> None:
        for child in devices_list.winfo_children():
            child.destroy()
        if error:
            ctk.CTkLabel(devices_list, text=error, font=theme.font(12), text_color=theme.TEXT_TERTIARY).pack(pady=8)
            return
        if not devices:
            ctk.CTkLabel(devices_list, text="Aucun appareil connecté", font=theme.font(12), text_color=theme.TEXT_TERTIARY).pack(pady=8)
            return
        for d in devices:
            row = ctk.CTkFrame(devices_list, fg_color=theme.SURFACE_1, corner_radius=6)
            row.pack(fill="x", pady=3)
            ctk.CTkLabel(row, text=d.get("ip", "?"), font=theme.font(12, "bold"), text_color=theme.TEXT_PRIMARY).pack(side="left", padx=8, pady=6)
            secs = d.get("connected_seconds", 0)
            mins, s = divmod(int(secs), 60)
            duration = f"{mins}m{s:02d}s" if mins else f"{s}s"
            ctk.CTkLabel(row, text=duration, font=theme.font(11), text_color=theme.TEXT_TERTIARY).pack(side="right", padx=8)

    def fetch_devices_bg() -> None:
        """Appel HTTP bloquant — toujours en thread de fond, jamais sur le
        thread Tkinter. Le résultat est ramené sur le thread principal via
        .after(0, ...), seul thread autorisé à toucher les widgets."""
        try:
            resp = httpx.get(
                f"http://127.0.0.1:{settings.PORT}/api/devices",
                params={"token": settings.AUTH_TOKEN}, timeout=3.0,
            )
            resp.raise_for_status()
            devices = resp.json()
            parent.after(0, lambda: render_devices(devices))
        except Exception:
            parent.after(0, lambda: render_devices(None, error="Appareils indisponibles"))

    # ── Boucles de rafraîchissement (thread principal uniquement) ──────────
    def poll_logs() -> None:
        while not controller.log_queue.empty():
            append_log(controller.log_queue.get())
        parent.after(LOG_POLL_MS, poll_logs)

    def poll_state() -> None:
        state = controller.state
        if state != last_seen_state["value"]:
            last_seen_state["value"] = state
            running = state == "running"
            status_dot.configure(text_color=theme.ACCENT if running else theme.TEXT_TERTIARY)
            status_label.configure(text="En cours" if running else "Arrêté")
            btn_start.configure(state="disabled" if running else "normal")
            btn_restart.configure(state="normal" if running else "disabled")
            btn_stop.configure(state="normal" if running else "disabled")
            if not running:
                render_devices(None, error="Serveur arrêté")
        parent.after(200, poll_state)

    def poll_devices() -> None:
        if controller.state == "running":
            threading.Thread(target=fetch_devices_bg, daemon=True).start()
        parent.after(DEVICES_POLL_MS, poll_devices)

    # État initial des boutons (serveur arrêté au lancement de l'app)
    btn_restart.configure(state="disabled")
    btn_stop.configure(state="disabled")

    parent.after(LOG_POLL_MS, poll_logs)
    parent.after(200, poll_state)
    parent.after(DEVICES_POLL_MS, poll_devices)
