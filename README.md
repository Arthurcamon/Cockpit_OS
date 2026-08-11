# Cockpit OS

Interface tactile locale multimédia inspirée d'Android Auto / Tesla.

## Fonctionnalités

- **Bibliothèque Deezer** : navigation playlists, albums, artistes, recherche
- **Lecteur multimédia Windows** : contrôle play/pause/next/previous, affichage de la piste en cours
- **Contrôle audio Windows** : volume général, volume par application
- **Communication temps réel** : WebSocket bidirectionnel (aucun appel direct JS → service Python)

## Lancement

```bash
cd cockpit-os
pip install -r requirements.txt
python main.py
```

Puis ouvrir http://localhost:8000

## Architecture

```
cockpit-os/
├── main.py              # Point d'entrée
├── config.py            # Configuration centralisée
├── requirements.txt     # Dépendances Python
│
├── core/
│   ├── app.py           # Serveur FastAPI (routes, statiques, WebSocket)
│   ├── websocket.py     # Gestionnaire WebSocket (dispatch des messages)
│   └── logger.py        # Logger partagé
│
├── services/
│   ├── deezer_api.py    # Accès aux données Deezer (API publique)
│   ├── deezer_player.py # Lancer une piste dans Deezer Desktop
│   ├── windows_media.py # Contrôle Windows Media Session (play/pause/next…)
│   └── windows_audio.py # Contrôle audio Windows (volume, périphériques)
│
└── web/
    ├── index.html       # Page principale
    ├── css/style.css    # Thème sombre tactile
    ├── js/app.js        # Logique frontend (WebSocket, UI)
    └── tabs/
        ├── deezer.html  # Onglet bibliothèque Deezer
        └── media.html   # Onglet lecteur media
```

## Protocole WebSocket

**Frontend → Backend**

| Type | Paramètres | Description |
|------|-----------|-------------|
| `media.command` | `command`: play/pause/next/previous/toggle | Contrôle le lecteur Windows |
| `deezer.search` | `query`, `filter`: track/artist/album | Recherche Deezer |
| `deezer.playlists` | — | Récupère les playlists de l'utilisateur |
| `deezer.playlist.tracks` | `playlist_id` | Morceaux d'une playlist |
| `deezer.album.tracks` | `album_id` | Morceaux d'un album |
| `deezer.artist.albums` | `artist_id` | Albums d'un artiste |
| `deezer.play` | `track_id`, `title` | Lance la piste dans Deezer Desktop |
| `audio.command` | `command`, `value`… | Contrôle audio (volume, mute) |

**Backend → Frontend**

| Type | Description |
|------|-------------|
| `media.state` | État complet du lecteur (titre, artiste, statut, progression) |
| `audio.state` | État audio (volume, applications) |
| `deezer.*.results` | Résultats des requêtes Deezer |
| `deezer.player.launched` | Confirmation de lancement d'une piste |
| `system.connected` | Confirmation de connexion WebSocket |
| `error` | Message d'erreur |

## Dépendances Windows (sur la machine cible)

Pour activer le contrôle réel Windows :

```bash
pip install winsdk        # Windows Media Session API
pip install pycaw comtypes # Contrôle audio Windows
```

Sur Linux / Replit, l'application fonctionne en **mode simulation** avec des données de démonstration.

## Modules futurs prévus

- OBS Studio
- SimHub (racing telemetry)
- Discord
- Système de plugins
