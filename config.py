"""
Cockpit OS — Configuration centrale
Toutes les constantes et paramètres de l'application sont définis ici.
"""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    # Serveur
    HOST: str = "0.0.0.0"
    PORT: int = int(os.environ.get("PORT", 8000))
    DEBUG: bool = os.environ.get("DEBUG", "false").lower() == "true"

    # Deezer
    DEEZER_API_BASE: str = "https://api.deezer.com"
    DEEZER_USER_ID: str = os.environ.get("DEEZER_USER_ID", "1269079644")
    # OAuth Deezer (prévu pour une future version)
    DEEZER_APP_ID: str = os.environ.get("DEEZER_APP_ID", "")
    DEEZER_SECRET: str = os.environ.get("DEEZER_SECRET", "")

    # WebSocket
    WS_PING_INTERVAL: int = 30  # secondes entre chaque ping
    WS_PING_TIMEOUT: int = 10   # délai d'attente avant déconnexion

    # Polling média Windows (millisecondes)
    MEDIA_POLL_INTERVAL: float = 1.0  # secondes entre chaque lecture de l'état


# Instance unique partagée dans toute l'application
settings = Settings()
