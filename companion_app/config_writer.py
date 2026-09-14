"""
Cockpit OS — App compagnon : lecture/écriture de shortcuts_config.json.

Même discipline de concurrence que services/steam_covers.py côté serveur :
relecture du fichier JUSTE avant chaque écriture (jamais depuis une copie
en mémoire obsolète), modification CIBLÉE des seuls champs qui reviennent
à l'app compagnon, écriture atomique (fichier temporaire + os.replace).
main.py peut écrire "cover_path" en tâche de fond à tout moment (voir
_game_covers_task, core/app.py) — ces fonctions ne doivent JAMAIS
l'écraser, d'où le filtrage explicite dans update_app().
"""

import json
import os
import re
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "shortcuts_config.json"

# Seul services/steam_covers.py (côté serveur) est autorisé à écrire ce
# champ — voir Note/, volet A point 2. Filtré même si transmis par erreur
# à update_app() par un appelant interne à l'app compagnon.
_PROTECTED_FIELDS = {"cover_path"}


def _read_raw() -> dict:
    if not CONFIG_PATH.exists():
        return {"apps": [], "macros": []}
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def _write_raw(data: dict) -> None:
    tmp_path = CONFIG_PATH.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp_path, CONFIG_PATH)


def read_apps() -> list:
    return _read_raw().get("apps", [])


def read_macros() -> list:
    return _read_raw().get("macros", [])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "app"


def _unique_id(base_id: str, existing_ids: set) -> str:
    if base_id not in existing_ids:
        return base_id
    i = 2
    while f"{base_id}_{i}" in existing_ids:
        i += 1
    return f"{base_id}_{i}"


def add_app(name: str, command: str, type_: str, icon_path: Optional[str], process_names: list) -> dict:
    """Ajoute une nouvelle entrée "apps" (order = fin de liste). Retourne
    l'entrée créée (avec son id définitif, utile pour l'affichage
    immédiat sans relire tout le fichier)."""
    data = _read_raw()
    apps = data.setdefault("apps", [])
    existing_ids = {a.get("id") for a in apps}
    entry = {
        "id": _unique_id(_slugify(name), existing_ids),
        "name": name,
        "type": type_,
        "icon_class": "icon-app",  # repli générique si icon_path absent/échoué — voir shortcuts.js::resolveIconMarkup
        "icon_path": icon_path,
        "category": "Personnalisé",
        "command": command,
        "process_names": process_names,
        "order": len(apps),
    }
    if type_ == "game":
        entry["cover_path"] = None
    apps.append(entry)
    _write_raw(data)
    return entry


def update_app(app_id: str, **fields) -> bool:
    """Met à jour uniquement les champs donnés sur l'entrée `app_id`
    (rename, changement de type, etc.) — jamais "cover_path" (filtré)."""
    fields = {k: v for k, v in fields.items() if k not in _PROTECTED_FIELDS}
    if not fields:
        return False
    data = _read_raw()
    for app in data.get("apps", []):
        if app.get("id") == app_id:
            app.update(fields)
            _write_raw(data)
            return True
    return False


def remove_app(app_id: str) -> bool:
    data = _read_raw()
    apps = data.get("apps", [])
    new_apps = [a for a in apps if a.get("id") != app_id]
    if len(new_apps) == len(apps):
        return False
    data["apps"] = new_apps
    _write_raw(data)
    return True


def reorder_apps(id_order: list) -> None:
    """Réassigne "order" selon la position de chaque id dans `id_order`."""
    data = _read_raw()
    apps = data.get("apps", [])
    order_map = {app_id: i for i, app_id in enumerate(id_order)}
    apps.sort(key=lambda a: order_map.get(a.get("id"), len(id_order)))
    for i, app in enumerate(apps):
        app["order"] = i
    data["apps"] = apps
    _write_raw(data)


# ── Macros ("launch_app" / "wait" uniquement — voir core/shortcuts.py::
# _run_macro_step, seuls types d'étape réellement exécutés par le serveur ;
# ne jamais en proposer d'autres côté app compagnon) ─────────────────────

def add_macro(name: str, icon_class: Optional[str], steps: list) -> dict:
    data = _read_raw()
    macros = data.setdefault("macros", [])
    existing_ids = {m.get("id") for m in macros}
    entry = {
        "id": _unique_id(_slugify(name), existing_ids),
        "name": name,
        "icon_class": icon_class,
        "icon_path": None,
        "order": len(macros),
        "steps": steps,
    }
    macros.append(entry)
    _write_raw(data)
    return entry


def update_macro(macro_id: str, **fields) -> bool:
    data = _read_raw()
    for macro in data.get("macros", []):
        if macro.get("id") == macro_id:
            macro.update(fields)
            _write_raw(data)
            return True
    return False


def remove_macro(macro_id: str) -> bool:
    data = _read_raw()
    macros = data.get("macros", [])
    new_macros = [m for m in macros if m.get("id") != macro_id]
    if len(new_macros) == len(macros):
        return False
    data["macros"] = new_macros
    _write_raw(data)
    return True


def reorder_macros(id_order: list) -> None:
    data = _read_raw()
    macros = data.get("macros", [])
    order_map = {macro_id: i for i, macro_id in enumerate(id_order)}
    macros.sort(key=lambda m: order_map.get(m.get("id"), len(id_order)))
    for i, macro in enumerate(macros):
        macro["order"] = i
    data["macros"] = macros
    _write_raw(data)
