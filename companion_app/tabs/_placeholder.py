"""Contenu provisoire affiché dans un onglet dont l'implémentation réelle
arrive à une étape ultérieure du plan (voir Note/ pour le détail des
étapes) — retiré au fur et à mesure que chaque onglet est construit."""

import customtkinter as ctk

from companion_app import theme


def build_placeholder(parent: ctk.CTkFrame, label: str, step_note: str) -> None:
    parent.grid_columnconfigure(0, weight=1)
    parent.grid_rowconfigure(0, weight=1)

    wrap = ctk.CTkFrame(parent, fg_color="transparent")
    wrap.grid(row=0, column=0)

    ctk.CTkLabel(
        wrap, text=label, font=theme.font(20, "bold"), text_color=theme.TEXT_PRIMARY,
    ).pack(pady=(0, 6))
    ctk.CTkLabel(
        wrap, text=step_note, font=theme.font(13), text_color=theme.TEXT_TERTIARY,
    ).pack()
