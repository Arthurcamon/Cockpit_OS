"""
Cockpit OS — App compagnon : icône system tray (pystray).

pystray gère sa propre boucle de messages Windows dans un thread à part,
indépendante de la mainloop Tkinter — TOUTE action qui touche l'UI
Tkinter ou le ServerController partagé doit donc repasser par
app.after(0, ...) pour s'exécuter sur le thread principal Tkinter, jamais
directement depuis un callback pystray (chaque callback ci-dessous ne
fait que ça : planifier le vrai traitement sur le thread principal).
"""

import threading
import tkinter.messagebox as messagebox

import pystray
from PIL import Image, ImageDraw, ImageFont

from companion_app import theme
from companion_app.server_control import ServerController

APP_TITLE = "Cockpit OS — Compagnon"


def _make_icon_image() -> Image.Image:
    """Icône générée par code (cercle plein couleur accent + « C » blanc)
    — évite de dépendre d'un fichier .ico externe que le projet ne fournit
    pas encore."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((2, 2, size - 2, size - 2), fill=theme.ACCENT)
    try:
        font = ImageFont.truetype("segoeuib.ttf", 34)
    except OSError:
        font = ImageFont.load_default()
    text = "C"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]), text, fill="white", font=font)
    return img


class TrayIcon:
    def __init__(self, app, controller: ServerController):
        self.app = app
        self.controller = controller
        self.icon = pystray.Icon("cockpit_os_companion", icon=_make_icon_image(), title=APP_TITLE, menu=self._build_menu())

    def _build_menu(self) -> pystray.Menu:
        running = self.controller.state == "running"
        return pystray.Menu(
            pystray.MenuItem("Afficher", self._on_show, default=True),
            pystray.MenuItem("Arrêter le serveur" if running else "Lancer le serveur", self._on_toggle_server),
            pystray.MenuItem("Quitter", self._on_quit),
        )

    def refresh_menu(self) -> None:
        """Rappelée par le ServerController à chaque changement d'état
        (démarré depuis l'onglet Serveur OU depuis ce menu) pour garder le
        libellé Lancer/Arrêter synchronisé, quelle que soit la source du
        changement."""
        self.icon.menu = self._build_menu()
        try:
            self.icon.update_menu()
        except Exception:
            pass

    # ── Callbacks pystray (thread pystray) — ne font QUE planifier le
    # vrai traitement sur le thread principal Tkinter. ──

    def _on_show(self, icon=None, item=None) -> None:
        self.app.after(0, self._show_window)

    def _on_toggle_server(self, icon=None, item=None) -> None:
        self.app.after(0, self._toggle_server)

    def _on_quit(self, icon=None, item=None) -> None:
        self.app.after(0, self._handle_quit)

    # ── Handlers réels (thread principal Tkinter) ──

    def _show_window(self) -> None:
        self.app.deiconify()
        self.app.lift()
        self.app.focus_force()

    def _toggle_server(self) -> None:
        if self.controller.state == "running":
            self.controller.stop()
        else:
            self.controller.start()
        # refresh_menu() sera aussi appelé via on_state_change (app.py),
        # mais un appel immédiat évite d'attendre la transition d'état
        # pour les cas où le clic tray n'entraîne aucun changement réel
        # (ex: start() ignoré silencieusement si déjà en cours).
        self.refresh_menu()

    def _handle_quit(self) -> None:
        if self.controller.state == "running":
            answer = messagebox.askyesnocancel(
                "Quitter Cockpit OS Compagnon",
                "Le serveur tourne actuellement.\n\n"
                "Oui : arrêter le serveur puis quitter\n"
                "Non : quitter sans arrêter le serveur (il continue de tourner)\n"
                "Annuler : ne pas quitter",
            )
            if answer is None:  # Annuler
                return
            if answer:  # Oui
                self.controller.stop()
        self.icon.stop()
        self.app.destroy()

    def start(self) -> None:
        threading.Thread(target=self.icon.run, daemon=True).start()
