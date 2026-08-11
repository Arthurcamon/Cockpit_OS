"""
Cockpit OS — Point d'entrée principal
Lance le serveur FastAPI et initialise tous les services.
"""

import asyncio
import signal
import sys

import uvicorn

from config import settings
from core.logger import get_logger
from core.app import create_app

logger = get_logger(__name__)


def handle_shutdown(signum, frame):
    """Gestion propre de l'arrêt (Ctrl+C ou signal système)."""
    logger.info("Signal d'arrêt reçu. Fermeture de Cockpit OS...")
    sys.exit(0)


def main():
    """Point d'entrée principal de Cockpit OS."""
    # Gestion des signaux d'arrêt
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    logger.info("=" * 50)
    logger.info("  Cockpit OS — Démarrage")
    logger.info(f"  Serveur : http://{settings.HOST}:{settings.PORT}")
    logger.info(f"  Mode debug : {settings.DEBUG}")
    logger.info("=" * 50)

    # Création de l'application FastAPI
    app = create_app()

    # Configuration du serveur uvicorn
    config = uvicorn.Config(
        app=app,
        host=settings.HOST,
        port=settings.PORT,
        log_level="info" if not settings.DEBUG else "debug",
        reload=settings.DEBUG,
        # Désactive les pings automatiques WebSocket côté uvicorn.
        # Les winsdk IAsyncOperation peuvent occuper l'event loop quelques
        # centaines de ms — avec un ping_timeout court cela provoque des
        # déconnexions "keepalive ping timeout" qui empêchent les contrôles
        # de fonctionner. On gère la reconnexion côté frontend.
        ws_ping_interval=None,
        ws_ping_timeout=None,
    )

    server = uvicorn.Server(config)

    try:
        server.run()
    except KeyboardInterrupt:
        logger.info("Cockpit OS arrêté proprement.")


if __name__ == "__main__":
    main()
