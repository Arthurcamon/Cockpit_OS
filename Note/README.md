# Cockpit OS — Repère rapide

Interface tactile locale (français) pour piloter et superviser le PC depuis
une tablette Windows en cockpit. Serveur FastAPI + WebSocket, frontend
HTML/CSS/JS sans framework. Toutes les données affichées sont réelles
(lues en direct sur le PC) — jamais de valeurs simulées en façade.

Résumé détaillé (architecture, fonctions, logique complète) : voir
[Fichier.txt](Fichier.txt) dans ce même dossier.

## Lancer l'app

```bash
pip install -r requirements.txt
pip install winsdk pycaw comtypes   # requis sur Windows pour le contrôle réel
python main.py
```

Le lien à ouvrir sur la tablette (avec le token d'accès) s'affiche dans les
logs au démarrage. Ne jamais relancer le serveur de prod (port 8000) pendant
qu'il tourne déjà — utiliser un port isolé (ex. `PORT=8001`) pour tester.

## Les 4 onglets

| Onglet | Rôle | Fichiers clés |
|---|---|---|
| Raccourcis | Apps rapides, jeux Steam, actions système, fenêtres ouvertes | `web/js/shortcuts.js`, `core/shortcuts.py` |
| Setup | Supervision PC : Système, Applications ouvertes, Mixeur, Réseau Wi-Fi/Bluetooth | `web/js/app-ui-system.js`, `app-ui-audio.js`, `app-ui-network.js`, `services/system_monitor.py`, `process_monitor.py`, `wifi_service.py` |
| Deezer | Bibliothèque + lecture via Deezer Desktop (CDP) | `services/deezer_api.py`, `deezer_player.py` |
| Automobile | Lanceur plein écran Cockpit / Endurance (télémétrie SimHub) | `core/telemetry.py`, `web/tabs/dashboard.html`, `endurance.html` |

## Repères d'architecture

- **Un seul WebSocket** (`/ws`) pour tout le pilotage temps réel : messages
  JSON typés `{"type": "...", ...}`, dispatchés côté serveur par le registre
  `core/websocket.py::_HANDLERS`. Le frontend n'appelle jamais un service
  Python directement.
- **Un second WebSocket** (`/ws/telemetry`) dédié à la télémétrie SimHub.
- **5 tâches de fond** (polling média/audio/système/apps/Wi-Fi) diffusent
  l'état à tous les clients connectés dès qu'un changement est détecté.
- **Frontend** : un objet `State` (état connu côté client) + un objet `UI`
  étendu par chaque `app-ui-*.js`. Initialisation idempotente partout
  (`UI._xInitialized`) car les onglets sont injectés en HTML de façon
  asynchrone (`app.js::loadTabs`).
- **Aucune donnée inventée** : si une dépendance Windows manque ou qu'une
  lecture échoue, l'interface affiche un état "indisponible" explicite.

## Notes de travail associées

- [Fonctionnalites_par_onglet.txt](Fonctionnalites_par_onglet.txt) — détail
  fonctionnalité par fonctionnalité.
- [cahier-des-charges-onglets.md](cahier-des-charges-onglets.md) — cahier
  des charges par onglet.
- [Liste_animation_raccourcis.txt](Liste_animation_raccourcis.txt) — liste
  des animations de l'onglet Raccourcis.
