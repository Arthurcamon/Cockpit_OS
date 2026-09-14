"""
Cockpit OS — App compagnon PC — point d'entrée.

Lancer depuis la racine du projet :
    python -m companion_app.main
(le `sys.path` ci-dessous permet aussi `python companion_app/main.py`
directement, sans dépendre du répertoire de travail courant).
"""

import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from companion_app.app import run
else:
    from companion_app.app import run

if __name__ == "__main__":
    run()
