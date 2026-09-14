"""
Onglet Apps & Jeux (fusionné) — glisser-déposer d'un .exe/.lnk pour
ajouter une app rapide ou un jeu, extraction automatique de l'icône,
liste avec aperçu façon tuile tablette (icône carrée pour une app,
vignette portrait pour un jeu), réorganisation, suppression, renommage.

Réorganisation : implémentée via des boutons ▲/▼ par ligne plutôt qu'un
vrai glisser-déposer DANS la liste — une liste triable par glisser-déposer
n'a pas de support natif Tkinter et demande un suivi de souris fait
maison ; les boutons ▲/▼ couvrent le même besoin fonctionnel ("met à jour
order") de façon nettement plus robuste pour un outil utilitaire.

Jaquette Steam (cover_path) : jamais écrite par l'app compagnon — c'est
main.py qui la récupère de façon asynchrone (services/steam_covers.py,
voir volet A). Un jeu nouvellement ajouté affiche donc le placeholder en
dégradé jusqu'à ce que le serveur la trouve et que ce fichier soit rouvert
(pas de rafraîchissement live depuis ici — cover_path est un souci du
serveur/tablette, pas de cet onglet).
"""

import hashlib
import tkinter.messagebox as messagebox
from pathlib import Path
from typing import Optional

import customtkinter as ctk
from tkinterdnd2 import DND_FILES

from companion_app import config_writer, icon_extract, theme
from companion_app.server_control import ServerController

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ICON_DIR = PROJECT_ROOT / "assets" / "shortcut_icons"

# Palette de repli déterministe pour les jeux sans jaquette (cover_path
# encore null) — même esprit que shortcuts.js::paletteFor (dégradé
# pseudo-aléatoire mais stable par id), simplifié en couleurs pleines
# (CTkFrame ne supporte pas les dégradés CSS).
_GAME_PLACEHOLDER_COLORS = ["#3a2d5c", "#2d4a5c", "#5c2d3a", "#2d5c3f", "#5c4a2d"]


def _placeholder_color(key: str) -> str:
    h = int(hashlib.md5(key.encode("utf-8")).hexdigest(), 16)
    return _GAME_PLACEHOLDER_COLORS[h % len(_GAME_PLACEHOLDER_COLORS)]


def _resolve_asset_path(icon_path: Optional[str]) -> Optional[Path]:
    """"/assets/shortcut_icons/x.png" (chemin web, tel que stocké dans
    shortcuts_config.json) -> chemin disque réel. None si absent/introuvable."""
    if not icon_path:
        return None
    rel = icon_path.lstrip("/")
    if rel.startswith("assets/"):
        rel = rel[len("assets/"):]
    p = PROJECT_ROOT / "assets" / rel
    return p if p.exists() else None


def build(parent: ctk.CTkFrame, controller: ServerController) -> None:
    parent.grid_columnconfigure(0, weight=1)
    parent.grid_rowconfigure(1, weight=1)

    # ── Zone de glisser-déposer ──────────────────────────────────────────
    drop_zone = ctk.CTkFrame(parent, fg_color=theme.SURFACE_2, corner_radius=10, border_width=2, border_color=theme.ACCENT_SOFT)
    drop_zone.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    ctk.CTkLabel(
        drop_zone, text="⬇  Glisse un .exe, un raccourci .lnk ou .url (Steam) ici pour l'ajouter",
        font=theme.font(14, "bold"), text_color=theme.TEXT_SECONDARY,
    ).pack(pady=22)

    # ── Liste des apps/jeux existants ───────────────────────────────────
    list_frame = ctk.CTkScrollableFrame(parent, fg_color="transparent")
    list_frame.grid(row=1, column=0, sticky="nsew")

    def refresh_list() -> None:
        for child in list_frame.winfo_children():
            child.destroy()
        apps = sorted(config_writer.read_apps(), key=lambda a: a.get("order", 0))
        if not apps:
            ctk.CTkLabel(list_frame, text="Aucune app ou jeu configuré — dépose un .exe/.lnk/.url ci-dessus", font=theme.font(12), text_color=theme.TEXT_TERTIARY).pack(pady=16)
            return
        for i, app in enumerate(apps):
            _build_row(list_frame, app, i, len(apps), refresh_list)

    def on_drop(event) -> None:
        paths = parent.tk.splitlist(event.data)
        if not paths:
            return
        path = paths[0]
        ext = Path(path).suffix.lower()
        if ext not in (".exe", ".lnk", ".url"):
            messagebox.showwarning("Format non supporté", f"'{Path(path).name}' n'est ni un .exe, ni un .lnk, ni un .url.")
            return
        _open_add_dialog(parent, path, refresh_list)

    drop_zone.drop_target_register(DND_FILES)
    drop_zone.dnd_bind("<<Drop>>", on_drop)

    refresh_list()


def _build_row(list_frame: ctk.CTkScrollableFrame, app: dict, index: int, total: int, on_change) -> None:
    row = ctk.CTkFrame(list_frame, fg_color=theme.SURFACE_2, corner_radius=8)
    row.pack(fill="x", pady=4, padx=2)

    is_game = app.get("type") == "game"

    # Vignette : carrée pour une app, portrait pour un jeu (cohérent avec
    # la vraie tuile tablette — voir docstring du module).
    thumb_size = (36, 48) if is_game else (40, 40)
    asset_path = _resolve_asset_path(app.get("cover_path") if is_game else app.get("icon_path"))
    thumb_holder = ctk.CTkFrame(row, width=thumb_size[0], height=thumb_size[1], corner_radius=6, fg_color=_placeholder_color(app.get("id", "")))
    thumb_holder.pack(side="left", padx=(10, 12), pady=10)
    thumb_holder.pack_propagate(False)
    if asset_path:
        try:
            from PIL import Image
            img = Image.open(asset_path)
            ctk_img = ctk.CTkImage(light_image=img, dark_image=img, size=thumb_size)
            ctk.CTkLabel(thumb_holder, image=ctk_img, text="").pack(expand=True, fill="both")
        except Exception:
            pass  # reste sur le fond de couleur de repli

    info = ctk.CTkFrame(row, fg_color="transparent")
    info.pack(side="left", fill="both", expand=True, pady=8)

    name_label = ctk.CTkLabel(info, text=app.get("name", app.get("id", "?")), font=theme.font(14, "bold"), text_color=theme.TEXT_PRIMARY, anchor="w")
    name_label.pack(anchor="w")
    badge_text = "🎮 Jeu" if is_game else "📦 App rapide"
    ctk.CTkLabel(info, text=badge_text, font=theme.font(11), text_color=theme.TEXT_TERTIARY, anchor="w").pack(anchor="w")

    def do_rename() -> None:
        _open_rename_dialog(list_frame, app, on_change)

    ctk.CTkButton(row, text="✎", width=32, fg_color=theme.SURFACE_1, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY, command=do_rename).pack(side="left", padx=2)

    def do_up() -> None:
        if index == 0:
            return
        apps = sorted(config_writer.read_apps(), key=lambda a: a.get("order", 0))
        ids = [a["id"] for a in apps]
        ids[index - 1], ids[index] = ids[index], ids[index - 1]
        config_writer.reorder_apps(ids)
        on_change()

    def do_down() -> None:
        if index >= total - 1:
            return
        apps = sorted(config_writer.read_apps(), key=lambda a: a.get("order", 0))
        ids = [a["id"] for a in apps]
        ids[index + 1], ids[index] = ids[index], ids[index + 1]
        config_writer.reorder_apps(ids)
        on_change()

    ctk.CTkButton(row, text="▲", width=28, fg_color=theme.SURFACE_1, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY, state="disabled" if index == 0 else "normal", command=do_up).pack(side="left", padx=1)
    ctk.CTkButton(row, text="▼", width=28, fg_color=theme.SURFACE_1, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY, state="disabled" if index >= total - 1 else "normal", command=do_down).pack(side="left", padx=(1, 10))

    def do_delete() -> None:
        if messagebox.askyesno("Supprimer", f"Retirer '{app.get('name')}' de la liste ?\n(Ne désinstalle rien — seulement l'entrée dans Cockpit OS.)"):
            config_writer.remove_app(app["id"])
            on_change()

    ctk.CTkButton(row, text="✕", width=32, fg_color=theme.DANGER, hover_color=theme.DANGER_HOVER, text_color=theme.TEXT_PRIMARY, command=do_delete).pack(side="right", padx=10)


def _open_rename_dialog(parent: ctk.CTkBaseClass, app: dict, on_change) -> None:
    dlg = ctk.CTkToplevel(parent)
    dlg.title("Renommer")
    dlg.geometry("360x150")
    dlg.configure(fg_color=theme.SURFACE_1)
    dlg.transient(parent.winfo_toplevel())
    dlg.grab_set()

    ctk.CTkLabel(dlg, text="Nom affiché", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(anchor="w", padx=16, pady=(16, 4))
    entry = ctk.CTkEntry(dlg, fg_color=theme.SURFACE_2, text_color=theme.TEXT_PRIMARY)
    entry.insert(0, app.get("name", ""))
    entry.pack(fill="x", padx=16)

    def confirm() -> None:
        new_name = entry.get().strip()
        if new_name:
            config_writer.update_app(app["id"], name=new_name)
            on_change()
        dlg.destroy()

    btn_row = ctk.CTkFrame(dlg, fg_color="transparent")
    btn_row.pack(fill="x", padx=16, pady=16)
    ctk.CTkButton(btn_row, text="Annuler", fg_color=theme.SURFACE_2, hover_color=theme.SURFACE_2_HOVER, command=dlg.destroy).pack(side="left", expand=True, fill="x", padx=(0, 6))
    ctk.CTkButton(btn_row, text="Enregistrer", fg_color=theme.ACCENT, hover_color=theme.ACCENT_HOVER, command=confirm).pack(side="left", expand=True, fill="x", padx=(6, 0))


def _open_add_dialog(parent: ctk.CTkBaseClass, dropped_path: str, on_added) -> None:
    command, suggested_name, process_name = icon_extract.resolve_drop_info(dropped_path)

    dlg = ctk.CTkToplevel(parent)
    dlg.title("Ajouter")
    dlg.geometry("380x360")
    dlg.configure(fg_color=theme.SURFACE_1)
    dlg.transient(parent.winfo_toplevel())
    dlg.grab_set()

    ctk.CTkLabel(dlg, text="Nom affiché", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(anchor="w", padx=16, pady=(16, 4))
    name_entry = ctk.CTkEntry(dlg, fg_color=theme.SURFACE_2, text_color=theme.TEXT_PRIMARY)
    name_entry.insert(0, suggested_name)
    name_entry.pack(fill="x", padx=16)

    ctk.CTkLabel(dlg, text="Type", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(anchor="w", padx=16, pady=(14, 4))
    type_var = ctk.StringVar(value="App rapide")
    type_toggle = ctk.CTkSegmentedButton(
        dlg, values=["App rapide", "Jeu"], variable=type_var,
        fg_color=theme.SURFACE_2, selected_color=theme.ACCENT, selected_hover_color=theme.ACCENT_HOVER,
        unselected_color=theme.SURFACE_2, text_color=theme.TEXT_PRIMARY,
    )
    type_toggle.pack(fill="x", padx=16)

    ctk.CTkLabel(dlg, text=f"Commande : {command}", font=theme.font(11), text_color=theme.TEXT_TERTIARY, wraplength=340, justify="left").pack(anchor="w", padx=16, pady=(10, 0))

    status_label = ctk.CTkLabel(dlg, text="", font=theme.font(11), text_color=theme.TEXT_TERTIARY, wraplength=340, justify="left")
    status_label.pack(anchor="w", padx=16, pady=(8, 0))

    def confirm() -> None:
        name = name_entry.get().strip()
        if not name:
            status_label.configure(text="Le nom ne peut pas être vide.", text_color=theme.DANGER)
            return
        type_ = "game" if type_var.get() == "Jeu" else "app"
        process_names = [process_name] if process_name else []

        entry = config_writer.add_app(name, command, type_, icon_path=None, process_names=process_names)

        ok, err = icon_extract.extract_icon(dropped_path, ICON_DIR / f"{entry['id']}.png")
        if ok:
            config_writer.update_app(entry["id"], icon_path=f"/assets/shortcut_icons/{entry['id']}.png")
        else:
            # Signalé, jamais avalé en silence (voir plan, étape 8) — l'entrée
            # reste ajoutée avec repli sur l'icône générique côté tablette.
            messagebox.showwarning("Icône non extraite", f"'{name}' a été ajouté, mais son icône n'a pas pu être extraite :\n{err}\n\nUne icône générique sera affichée sur la tablette.")

        on_added()
        dlg.destroy()

    btn_row = ctk.CTkFrame(dlg, fg_color="transparent")
    btn_row.pack(fill="x", padx=16, pady=20, side="bottom")
    ctk.CTkButton(btn_row, text="Annuler", fg_color=theme.SURFACE_2, hover_color=theme.SURFACE_2_HOVER, command=dlg.destroy).pack(side="left", expand=True, fill="x", padx=(0, 6))
    ctk.CTkButton(btn_row, text="Ajouter", fg_color=theme.ACCENT, hover_color=theme.ACCENT_HOVER, command=confirm).pack(side="left", expand=True, fill="x", padx=(6, 0))
