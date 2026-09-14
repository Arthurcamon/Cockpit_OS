"""Cockpit OS — App compagnon : résolution de l'IP locale (LAN), pour le
QR code de connexion et l'URL affichée dans l'onglet Serveur. main.py
écoute sur 0.0.0.0 (settings.HOST) — ni "0.0.0.0" ni "127.0.0.1" ne sont
une adresse utilisable par la tablette, il faut la vraie IP LAN de ce PC."""

import socket


def get_local_ip() -> str:
    """Astuce standard sans dépendance : ouvre un socket UDP vers une
    adresse externe (aucun paquet réellement envoyé, UDP est sans
    connexion) uniquement pour lire l'adresse locale que l'OS choisirait
    pour cette route — donne la vraie IP LAN même sur une machine
    multi-interfaces. Repli sur 127.0.0.1 si totalement hors-ligne."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()
