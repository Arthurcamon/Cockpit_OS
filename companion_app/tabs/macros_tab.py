"""
Onglet Macros — créateur de séquences d'actions, réorganisation (▲/▼,
même choix que l'onglet Apps & Jeux), suppression, édition.

Types d'étape : UNIQUEMENT "launch_app" et "wait" — les deux seuls que
core/shortcuts.py::_run_macro_step sait réellement exécuter (vérifié dans
le code serveur avant d'écrire cet onglet). Ne jamais en proposer
d'autres dans l'interface : ça créerait une étape que le serveur ignore
silencieusement à l'exécution (voir le commentaire de _run_macro_step).
"""

import tkinter.messagebox as messagebox
from typing import Optional

import customtkinter as ctk

from companion_app import config_writer, theme
from companion_app.server_control import ServerController

ICON_CHOICES = [
    ("Générique", None),
    ("Jauge", "icon-gauge"),
    ("Musique", "icon-music"),
    ("Jeu", "icon-gamepad"),
    ("Casque", "icon-headset"),
    ("Réglages", "icon-settings"),
    ("Dossier", "icon-folder"),
    ("Cube", "icon-cube"),
    ("Étincelle", "icon-spark"),
    ("Navigateur", "icon-browser"),
    ("Discord", "icon-discord"),
]
ICON_LABELS = [label for label, _ in ICON_CHOICES]
ICON_LABEL_TO_CLASS = dict(ICON_CHOICES)
ICON_CLASS_TO_LABEL = {v: k for k, v in ICON_CHOICES}


def build(parent: ctk.CTkFrame, controller: ServerController) -> None:
    parent.grid_columnconfigure(0, weight=1)
    parent.grid_rowconfigure(1, weight=1)

    header = ctk.CTkFrame(parent, fg_color="transparent")
    header.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    ctk.CTkLabel(header, text="Macros", font=theme.font(18, "bold"), text_color=theme.TEXT_PRIMARY).pack(side="left")

    list_frame = ctk.CTkScrollableFrame(parent, fg_color="transparent")
    list_frame.grid(row=1, column=0, sticky="nsew")

    def refresh_list() -> None:
        for child in list_frame.winfo_children():
            child.destroy()
        macros = sorted(config_writer.read_macros(), key=lambda m: m.get("order", 0))
        if not macros:
            ctk.CTkLabel(list_frame, text="Aucune macro configurée", font=theme.font(12), text_color=theme.TEXT_TERTIARY).pack(pady=16)
        else:
            for i, macro in enumerate(macros):
                _build_row(list_frame, macro, i, len(macros), refresh_list)

    ctk.CTkButton(
        header, text="+ Nouvelle macro", fg_color=theme.ACCENT, hover_color=theme.ACCENT_HOVER,
        text_color=theme.TEXT_PRIMARY, font=theme.font(13, "bold"),
        command=lambda: _open_macro_dialog(parent, None, refresh_list),
    ).pack(side="right")

    refresh_list()


def _step_summary(step: dict) -> str:
    if step.get("type") == "launch_app":
        return f"Lancer « {step.get('app_id', '?')} »"
    if step.get("type") == "wait":
        return f"Attendre {step.get('seconds', 0)}s"
    return f"Étape inconnue ({step.get('type')})"


def _build_row(list_frame: ctk.CTkScrollableFrame, macro: dict, index: int, total: int, on_change) -> None:
    row = ctk.CTkFrame(list_frame, fg_color=theme.SURFACE_2, corner_radius=8)
    row.pack(fill="x", pady=4, padx=2)

    info = ctk.CTkFrame(row, fg_color="transparent")
    info.pack(side="left", fill="both", expand=True, padx=(14, 10), pady=10)
    ctk.CTkLabel(info, text=macro.get("name", macro.get("id", "?")), font=theme.font(14, "bold"), text_color=theme.TEXT_PRIMARY, anchor="w").pack(anchor="w")
    steps = macro.get("steps", [])
    summary = " → ".join(_step_summary(s) for s in steps) if steps else "Aucune étape"
    ctk.CTkLabel(info, text=summary, font=theme.font(11), text_color=theme.TEXT_TERTIARY, anchor="w", wraplength=480, justify="left").pack(anchor="w")

    ctk.CTkButton(
        row, text="✎", width=32, fg_color=theme.SURFACE_1, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY,
        command=lambda: _open_macro_dialog(list_frame, macro, on_change),
    ).pack(side="left", padx=2)

    def move(delta: int) -> None:
        macros = sorted(config_writer.read_macros(), key=lambda m: m.get("order", 0))
        ids = [m["id"] for m in macros]
        j = index + delta
        if 0 <= j < len(ids):
            ids[index], ids[j] = ids[j], ids[index]
            config_writer.reorder_macros(ids)
            on_change()

    ctk.CTkButton(row, text="▲", width=28, fg_color=theme.SURFACE_1, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY, state="disabled" if index == 0 else "normal", command=lambda: move(-1)).pack(side="left", padx=1)
    ctk.CTkButton(row, text="▼", width=28, fg_color=theme.SURFACE_1, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY, state="disabled" if index >= total - 1 else "normal", command=lambda: move(1)).pack(side="left", padx=(1, 10))

    def do_delete() -> None:
        if messagebox.askyesno("Supprimer", f"Supprimer la macro '{macro.get('name')}' ?"):
            config_writer.remove_macro(macro["id"])
            on_change()

    ctk.CTkButton(row, text="✕", width=32, fg_color=theme.DANGER, hover_color=theme.DANGER_HOVER, text_color=theme.TEXT_PRIMARY, command=do_delete).pack(side="right", padx=10)


def _open_macro_dialog(parent, existing: Optional[dict], on_saved) -> None:
    is_edit = existing is not None
    apps = sorted(config_writer.read_apps(), key=lambda a: a.get("order", 0))
    app_names = [a["name"] for a in apps]
    app_name_to_id = {a["name"]: a["id"] for a in apps}
    app_id_to_name = {a["id"]: a["name"] for a in apps}

    # État local des étapes en cours d'édition — écrit dans la config
    # seulement au clic sur "Enregistrer".
    working_steps = [dict(s) for s in (existing.get("steps", []) if is_edit else [])]

    dlg = ctk.CTkToplevel(parent)
    dlg.title("Modifier la macro" if is_edit else "Nouvelle macro")
    dlg.geometry("460x560")
    dlg.configure(fg_color=theme.SURFACE_1)
    dlg.transient(parent.winfo_toplevel())
    dlg.grab_set()

    ctk.CTkLabel(dlg, text="Nom", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(anchor="w", padx=16, pady=(16, 4))
    name_entry = ctk.CTkEntry(dlg, fg_color=theme.SURFACE_2, text_color=theme.TEXT_PRIMARY)
    name_entry.insert(0, existing.get("name", "") if is_edit else "")
    name_entry.pack(fill="x", padx=16)

    ctk.CTkLabel(dlg, text="Icône", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(anchor="w", padx=16, pady=(12, 4))
    icon_var = ctk.StringVar(value=ICON_CLASS_TO_LABEL.get(existing.get("icon_class") if is_edit else None, "Générique"))
    ctk.CTkOptionMenu(
        dlg, values=ICON_LABELS, variable=icon_var, fg_color=theme.SURFACE_2, button_color=theme.SURFACE_2,
        button_hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_PRIMARY, dropdown_fg_color=theme.SURFACE_2,
    ).pack(fill="x", padx=16)

    ctk.CTkLabel(dlg, text="Actions", font=theme.font(13, "bold"), text_color=theme.TEXT_PRIMARY).pack(anchor="w", padx=16, pady=(14, 4))
    steps_frame = ctk.CTkScrollableFrame(dlg, fg_color=theme.SURFACE_2, corner_radius=8, height=220)
    steps_frame.pack(fill="both", expand=True, padx=16)

    def render_steps() -> None:
        for child in steps_frame.winfo_children():
            child.destroy()
        if not working_steps:
            ctk.CTkLabel(steps_frame, text="Aucune action — ajoute-en une ci-dessous", font=theme.font(11), text_color=theme.TEXT_TERTIARY).pack(pady=10)
        for i, step in enumerate(working_steps):
            _build_step_row(steps_frame, step, i, len(working_steps), app_names, app_name_to_id, app_id_to_name, working_steps, render_steps)

    def add_launch_step() -> None:
        default_app_id = apps[0]["id"] if apps else None
        working_steps.append({"type": "launch_app", "app_id": default_app_id})
        render_steps()

    def add_wait_step() -> None:
        working_steps.append({"type": "wait", "seconds": 2})
        render_steps()

    add_row = ctk.CTkFrame(dlg, fg_color="transparent")
    add_row.pack(fill="x", padx=16, pady=(8, 0))
    ctk.CTkButton(add_row, text="+ Lancer une app", fg_color=theme.SURFACE_2, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_PRIMARY, command=add_launch_step).pack(side="left", expand=True, fill="x", padx=(0, 6))
    ctk.CTkButton(add_row, text="+ Attendre", fg_color=theme.SURFACE_2, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_PRIMARY, command=add_wait_step).pack(side="left", expand=True, fill="x", padx=(6, 0))

    status_label = ctk.CTkLabel(dlg, text="", font=theme.font(11), text_color=theme.DANGER)
    status_label.pack(anchor="w", padx=16, pady=(6, 0))

    def confirm() -> None:
        name = name_entry.get().strip()
        if not name:
            status_label.configure(text="Le nom ne peut pas être vide.")
            return
        if not working_steps:
            status_label.configure(text="Ajoute au moins une action.")
            return
        icon_class = ICON_LABEL_TO_CLASS.get(icon_var.get())
        if is_edit:
            config_writer.update_macro(existing["id"], name=name, icon_class=icon_class, steps=working_steps)
        else:
            config_writer.add_macro(name, icon_class, working_steps)
        on_saved()
        dlg.destroy()

    btn_row = ctk.CTkFrame(dlg, fg_color="transparent")
    btn_row.pack(fill="x", padx=16, pady=16, side="bottom")
    ctk.CTkButton(btn_row, text="Annuler", fg_color=theme.SURFACE_2, hover_color=theme.SURFACE_2_HOVER, command=dlg.destroy).pack(side="left", expand=True, fill="x", padx=(0, 6))
    ctk.CTkButton(btn_row, text="Enregistrer", fg_color=theme.ACCENT, hover_color=theme.ACCENT_HOVER, command=confirm).pack(side="left", expand=True, fill="x", padx=(6, 0))

    render_steps()


def _build_step_row(steps_frame, step: dict, index: int, total: int, app_names: list, app_name_to_id: dict, app_id_to_name: dict, working_steps: list, on_change) -> None:
    row = ctk.CTkFrame(steps_frame, fg_color=theme.SURFACE_1, corner_radius=6)
    row.pack(fill="x", pady=3, padx=4)

    if step.get("type") == "launch_app":
        ctk.CTkLabel(row, text="Lancer", font=theme.font(12), text_color=theme.TEXT_SECONDARY).pack(side="left", padx=(10, 6))
        current_name = app_id_to_name.get(step.get("app_id"), "(app supprimée)")
        var = ctk.StringVar(value=current_name)

        def on_pick(choice: str) -> None:
            step["app_id"] = app_name_to_id.get(choice)

        if app_names:
            ctk.CTkOptionMenu(
                row, values=app_names, variable=var, command=on_pick, width=180,
                fg_color=theme.SURFACE_2, button_color=theme.SURFACE_2, button_hover_color=theme.SURFACE_2_HOVER,
                text_color=theme.TEXT_PRIMARY, dropdown_fg_color=theme.SURFACE_2,
            ).pack(side="left", padx=4, pady=6)
        else:
            ctk.CTkLabel(row, text="Aucune app configurée (onglet Apps & Jeux)", font=theme.font(11), text_color=theme.TEXT_TERTIARY).pack(side="left", padx=4)
    else:
        ctk.CTkLabel(row, text="Attendre", font=theme.font(12), text_color=theme.TEXT_SECONDARY).pack(side="left", padx=(10, 6))
        seconds_entry = ctk.CTkEntry(row, width=60, fg_color=theme.SURFACE_2, text_color=theme.TEXT_PRIMARY)
        seconds_entry.insert(0, str(step.get("seconds", 0)))
        seconds_entry.pack(side="left", pady=6)
        ctk.CTkLabel(row, text="s", font=theme.font(12), text_color=theme.TEXT_SECONDARY).pack(side="left", padx=(4, 4))

        def on_seconds_change(_event=None) -> None:
            try:
                step["seconds"] = max(0, int(float(seconds_entry.get())))
            except ValueError:
                pass
        seconds_entry.bind("<FocusOut>", on_seconds_change)
        seconds_entry.bind("<Return>", on_seconds_change)

    def move(delta: int) -> None:
        j = index + delta
        if 0 <= j < len(working_steps):
            working_steps[index], working_steps[j] = working_steps[j], working_steps[index]
            on_change()

    ctk.CTkButton(row, text="▲", width=24, fg_color=theme.SURFACE_2, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY, state="disabled" if index == 0 else "normal", command=lambda: move(-1)).pack(side="right", padx=1, pady=6)
    ctk.CTkButton(row, text="▼", width=24, fg_color=theme.SURFACE_2, hover_color=theme.SURFACE_2_HOVER, text_color=theme.TEXT_SECONDARY, state="disabled" if index >= total - 1 else "normal", command=lambda: move(1)).pack(side="right", padx=1, pady=6)

    def do_remove() -> None:
        working_steps.pop(index)
        on_change()

    ctk.CTkButton(row, text="✕", width=24, fg_color=theme.DANGER, hover_color=theme.DANGER_HOVER, text_color=theme.TEXT_PRIMARY, command=do_remove).pack(side="right", padx=(6, 4), pady=6)
