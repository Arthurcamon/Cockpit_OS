"""
Cockpit OS — App compagnon PC (fenêtre principale).

Les 5 onglets du plan sont tous implémentés (étapes 6-10). Comportement
system tray (étape 11) : fermer la fenêtre (✕) la minimise dans le tray
au lieu de quitter — seul "Quitter" depuis le menu du tray ferme
réellement l'app (voir companion_app/tray.py pour la confirmation avant
d'arrêter le serveur).

Un unique ServerController est créé ici et partagé entre tous les onglets
qui en ont besoin (Serveur pour le piloter, Performance pour lire le PID
du process qu'il gère) et le TrayIcon — personne d'autre ne doit créer son
propre ServerController, sous peine de piloter/lire un process différent
de celui réellement affiché dans l'onglet Serveur.
"""

import customtkinter as ctk
from tkinterdnd2 import TkinterDnD

from companion_app import theme
from companion_app.server_control import ServerController
from companion_app.tray import TrayIcon
from companion_app.tabs import (
    server_tab,
    performance_tab,
    apps_games_tab,
    macros_tab,
    devices_tab,
)

# Ordre des onglets = ordre du volet B du plan (Serveur, Apps & Jeux,
# Macros, Appareils connectés, Performance) — Performance placé en dernier
# dans le TabView malgré son numéro d'étape (7) plus bas que Apps & Jeux
# (8)/Macros (9)/Appareils (10) : l'ORDRE D'AFFICHAGE suit le plan, pas
# l'ordre d'implémentation. Chaque build_fn a la signature (parent,
# controller) — même les onglets qui n'utilisent pas encore le
# ServerController (Apps & Jeux, Macros), pour une signature uniforme.
TABS = [
    ("Serveur", server_tab.build),
    ("Apps & Jeux", apps_games_tab.build),
    ("Macros", macros_tab.build),
    ("Appareils connectés", devices_tab.build),
    ("Performance", performance_tab.build),
]


class CompanionApp(ctk.CTk, TkinterDnD.DnDWrapper):
    """Hérite aussi de TkinterDnD.DnDWrapper : seule façon d'obtenir le
    glisser-déposer natif (tkinterdnd2) sur une fenêtre CustomTkinter — CTk
    n'est pas TkinterDnD.Tk, donc l'extension Tcl tkdnd doit être greffée
    manuellement sur l'interpréteur déjà créé par CTk.__init__ via
    TkinterDnD._require (voir onglet Apps & Jeux, étape 8, seul
    utilisateur du drag-and-drop pour l'instant)."""

    def __init__(self):
        super().__init__()
        self.TkdndVersion = TkinterDnD._require(self)

        self.title("Cockpit OS — Compagnon")
        self.geometry("980x640")
        self.minsize(820, 560)
        self.configure(fg_color=theme.BG_APP)

        self.server_controller = ServerController()
        self._build_layout()

        # Tray : créé après le controller (a besoin de sa référence), puis
        # branché en retour sur le controller pour que le libellé Lancer/
        # Arrêter du menu reste synchronisé quel que soit l'endroit d'où le
        # démarrage/arrêt a été déclenché (onglet Serveur ou menu du tray).
        self.tray_icon = TrayIcon(self, self.server_controller)
        self.server_controller._on_state_change = lambda state: self.after(0, self.tray_icon.refresh_menu)
        self.tray_icon.start()

        # Fermer la fenêtre (✕) minimise dans le tray plutôt que de quitter
        # — seul "Quitter" depuis le menu du tray (tray.py::_handle_quit)
        # ferme réellement l'app.
        self.protocol("WM_DELETE_WINDOW", self.withdraw)

    def _build_layout(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        tabview = ctk.CTkTabview(
            self,
            fg_color=theme.SURFACE_1,
            segmented_button_fg_color=theme.SURFACE_1,
            segmented_button_selected_color=theme.ACCENT,
            segmented_button_selected_hover_color=theme.ACCENT_HOVER,
            segmented_button_unselected_color=theme.SURFACE_1,
            segmented_button_unselected_hover_color=theme.SURFACE_2,
            segmented_button_font=theme.font(13, "bold"),
            text_color=theme.TEXT_PRIMARY,
            corner_radius=12,
        )
        tabview.grid(row=0, column=0, sticky="nsew", padx=16, pady=16)

        for name, build_fn in TABS:
            tab_frame = tabview.add(name)
            tab_frame.configure(fg_color=theme.SURFACE_1)
            build_fn(tab_frame, self.server_controller)


def run() -> None:
    theme.apply_theme()
    app = CompanionApp()
    app.mainloop()
