"""
Cockpit OS — Configuration centrale
Toutes les constantes et paramètres de l'application sont définis ici.
"""

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

_TOKEN_FILE = Path(__file__).parent / ".cockpit_token"


def _load_or_create_auth_token() -> str:
    """
    Résout le token d'accès à l'app.
    Priorité : variable d'env COCKPIT_TOKEN > fichier local .cockpit_token
    (créé au premier lancement, jamais commité) > génération à la volée.
    Le fichier local garantit que le token reste stable entre redémarrages,
    pour que le favori tablette (avec le token dans l'URL) reste valide.
    """
    env_token = os.environ.get("COCKPIT_TOKEN")
    if env_token:
        return env_token

    if _TOKEN_FILE.exists():
        existing = _TOKEN_FILE.read_text(encoding="utf-8").strip()
        if existing:
            return existing

    new_token = secrets.token_urlsafe(24)
    try:
        _TOKEN_FILE.write_text(new_token, encoding="utf-8")
    except OSError:
        pass  # Répertoire en lecture seule ou autre — token valide pour cette session uniquement
    return new_token


@dataclass
class Settings:
    # Serveur
    HOST: str = "0.0.0.0"
    PORT: int = int(os.environ.get("PORT", 8000))
    DEBUG: bool = os.environ.get("DEBUG", "false").lower() == "true"

    # Authentification minimale (accès à la page, au WebSocket et aux routes /shortcuts)
    AUTH_TOKEN: str = field(default_factory=_load_or_create_auth_token)

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
