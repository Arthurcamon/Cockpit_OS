"""
Cockpit OS — App compagnon : palette et thème CustomTkinter.

Reprend telle quelle la palette sombre + accent bleu déjà utilisée côté
tablette (web/css/design-tokens.css), pour que l'app compagnon ressemble à
une extension de Cockpit OS plutôt qu'à un outil Tkinter générique — sans
viser les dégradés/glow de la tablette (effort de style modéré, voir le
plan : c'est un outil utilitaire).

Correspondance avec design-tokens.css :
  BG_APP      <- --bg-app          (#04050a)
  SURFACE_1   <- --rc-surface-1     (#12172a, panneaux)
  SURFACE_2   <- --rc-surface-2     (#232a44, cartes/tuiles)
  SURFACE_2_HOVER <- --rc-surface-2-hover (#2b3452)
  ACCENT      <- --notch-blue       (#6f97ff)
  ACCENT_SOFT <- --rc-accent-soft   (rgba(111,151,255,0.16))
  TEXT_PRIMARY   <- --rc-text-primary   (#ffffff)
  TEXT_SECONDARY <- --rc-text-secondary (#a7b3cc)
  TEXT_TERTIARY  <- --rc-text-tertiary  (#626c85)
  DANGER      <- --rc-danger        (#ff7a6b)
  HAIRLINE    <- --rc-hairline      (rgba(255,255,255,0.06), approximé en
                 solide ici — Tkinter ne fait pas de couleurs translucides)
"""

import customtkinter as ctk

BG_APP = "#04050a"
SURFACE_1 = "#12172a"
SURFACE_2 = "#232a44"
SURFACE_2_HOVER = "#2b3452"
ACCENT = "#6f97ff"
ACCENT_SOFT = "#26314f"   # approximation solide de rgba(111,151,255,0.16) sur SURFACE_1
ACCENT_HOVER = "#5c82e6"  # accent légèrement assombri, pour les boutons au survol
TEXT_PRIMARY = "#ffffff"
TEXT_SECONDARY = "#a7b3cc"
TEXT_TERTIARY = "#626c85"
DANGER = "#ff7a6b"
DANGER_HOVER = "#e05f52"
HAIRLINE = "#1c2238"  # approximation solide de rgba(255,255,255,0.06) sur SURFACE_1

FONT_FAMILY = "Segoe UI"


def apply_theme() -> None:
    """À appeler une seule fois, avant toute création de widget."""
    ctk.set_appearance_mode("dark")
    # Thème couleur par défaut ("blue") gardé comme base — la plupart des
    # couleurs sont de toute façon fixées explicitement par composant
    # ci-dessous plutôt que via le système de thème JSON de CustomTkinter,
    # pour rester au plus près de la palette Cockpit OS sans avoir à
    # maintenir un fichier de thème séparé.
    ctk.set_default_color_theme("blue")


def font(size: int = 13, weight: str = "normal") -> ctk.CTkFont:
    """Raccourci pour une police cohérente à travers l'app (Segoe UI, comme
    le reste de Windows — pas de choix de police custom)."""
    return ctk.CTkFont(family=FONT_FAMILY, size=size, weight=weight)
