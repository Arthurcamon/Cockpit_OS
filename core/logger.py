"""
Cockpit OS — Module de journalisation
Fournit un logger cohérent pour tous les modules de l'application.
"""

import logging
import sys
from typing import Optional

# La console Windows utilise par défaut un encodage historique (cp1252) qui ne
# supporte pas les emojis/accents utilisés dans les messages de log ("✅", "🎧"...).
# Sans ceci, logger.info(...) plante silencieusement (UnicodeEncodeError avalée
# par le module logging, qui l'affiche comme "--- Logging error ---").
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def get_logger(name: str, level: Optional[int] = None) -> logging.Logger:
    """
    Retourne un logger configuré pour le module donné.

    Args:
        name: Nom du module (utilisez __name__)
        level: Niveau de log optionnel (défaut : INFO)

    Returns:
        Logger configuré avec handlers console.
    """
    logger = logging.getLogger(name)

    # Évite d'ajouter des handlers en double si appelé plusieurs fois
    if logger.handlers:
        return logger

    logger.setLevel(level or logging.INFO)

    # Handler console avec formatage horodaté
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level or logging.INFO)

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    return logger
