"""
Cockpit OS — App compagnon : extraction d'icône + résolution de commande
de lancement depuis un fichier déposé (.exe, .lnk, ou .url).

.url (raccourci Internet, format InternetShortcut) : c'est le format que
Steam (et d'autres launchers) place dans le menu Démarrer pour la plupart
des jeux — pas de .exe direct, mais une URL de protocole personnalisé
(ex: "steam://rungameid/2399420") plus une icône déjà extraite sur disque
(IconFile=...ico). Contrairement à .exe/.lnk, il n'y a donc ici NI
exécutable à surveiller (process_names reste vide — impossible de savoir
quel .exe le jeu lancera réellement) NI extraction d'icône à faire depuis
un PE (le .ico est déjà prêt, simple lecture directe).

Extraction d'icône PE (.exe/.dll) : icoextract (lecture directe de la
section ressources) plutôt que l'approche classique pywin32 (ExtractIconEx
+ GDI/HICON/DIB), beaucoup plus fragile à reconstituer correctement avec
la transparence (canal alpha) intacte.

Résolution de cible .lnk : via win32com (WScript.Shell), seul point où
pywin32 reste nécessaire ici.

Ne lève jamais d'exception vers l'appelant : retourne toujours
(succès: bool, message_erreur: str | None) pour extract_icon — voir le
plan, volet B/étape 8 : "Signale-moi si un format pose problème plutôt
que d'échouer silencieusement", donc jamais un échec avalé en silence
non plus.
"""

import configparser
from pathlib import Path
from typing import Optional, Tuple

import win32com.client
from icoextract import IconExtractor
from icoextract.exceptions import IconExtractorError
from PIL import Image

ICON_SIZE = 96


def _parse_url_shortcut(path: str) -> dict:
    """Parse un .url (section [InternetShortcut]) — URL/IconFile/IconIndex,
    chaînes vides / index 0 si absents plutôt que de lever. Encodage : les
    .url sont généralement UTF-8, mais un ancien raccourci Windows peut
    être en ANSI (cp1252) — on retente dans ce cas plutôt que d'échouer."""
    cfg = configparser.ConfigParser()
    cfg.optionxform = str  # préserve la casse des clés (URL, IconFile, IconIndex)
    try:
        cfg.read(path, encoding="utf-8")
    except (UnicodeDecodeError, configparser.Error):
        cfg.read(path, encoding="cp1252")

    section = "InternetShortcut"
    if not cfg.has_section(section):
        return {"url": "", "icon_file": "", "icon_index": 0}
    try:
        icon_index = cfg.getint(section, "IconIndex", fallback=0)
    except ValueError:
        icon_index = 0
    return {
        "url": cfg.get(section, "URL", fallback=""),
        "icon_file": cfg.get(section, "IconFile", fallback=""),
        "icon_index": icon_index,
    }


def _resolve_icon_source(path: str) -> Tuple[str, int]:
    """Retourne (fichier_source, index) à passer à l'extraction d'icône.
    .lnk : IconLocation si définie, sinon TargetPath. .url : IconFile
    (déjà un .ico prêt à l'emploi côté Steam). .exe/.dll : tel quel."""
    low = path.lower()
    if low.endswith(".lnk"):
        shell = win32com.client.Dispatch("WScript.Shell")
        shortcut = shell.CreateShortCut(path)
        icon_location = (shortcut.IconLocation or "").strip()
        if icon_location and "," in icon_location:
            icon_path, idx_str = icon_location.rsplit(",", 1)
            icon_path = icon_path.strip()
            if icon_path:
                try:
                    return icon_path, int(idx_str)
                except ValueError:
                    return icon_path, 0
        return shortcut.TargetPath, 0
    if low.endswith(".url"):
        info = _parse_url_shortcut(path)
        if info["icon_file"]:
            return info["icon_file"], info["icon_index"]
        return path, 0  # pas d'IconFile déclaré — extract_icon échouera proprement (fichier .url n'est pas une icône)
    return path, 0


def extract_icon(source_path: str, dest_png: Path) -> Tuple[bool, Optional[str]]:
    """Extrait l'icône de `source_path` (.exe, .lnk ou .url) vers
    `dest_png` (PNG carré ICON_SIZE×ICON_SIZE, canal alpha préservé).
    Retourne (True, None) en cas de succès, (False, message) sinon —
    jamais d'exception propagée."""
    try:
        icon_path, index = _resolve_icon_source(source_path)
    except Exception as e:
        return False, f"Résolution de la cible du raccourci impossible : {e}"

    if not Path(icon_path).exists():
        return False, f"Fichier introuvable pour l'extraction d'icône : {icon_path}"

    try:
        if icon_path.lower().endswith(".ico"):
            # Déjà une icône prête (cas .url — Steam l'a extraite lui-même) :
            # lecture directe, PAS via icoextract qui attend un PE (.exe/.dll)
            # et échouerait sur un simple fichier .ico autonome.
            img = Image.open(icon_path).convert("RGBA")
        else:
            extractor = IconExtractor(icon_path)
            buf = extractor.get_icon(num=index)
            img = Image.open(buf).convert("RGBA")
    except IconExtractorError as e:
        return False, f"Aucune icône exploitable dans '{Path(icon_path).name}' : {e}"
    except Exception as e:
        return False, f"Extraction d'icône échouée ({type(e).__name__}) : {e}"

    try:
        if img.size != (ICON_SIZE, ICON_SIZE):
            img = img.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        dest_png.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest_png, "PNG")
    except OSError as e:
        return False, f"Écriture de l'icône échouée : {e}"

    return True, None


def resolve_drop_info(path: str) -> Tuple[str, str, str]:
    """Pour un fichier déposé (.exe, .lnk ou .url), retourne (commande,
    nom_affiché_suggéré, nom_de_process_exe) — la commande est DÉJÀ prête
    à écrire telle quelle dans shortcuts_config.json (guillemets/préfixe
    `start` selon le cas), l'appelant ne doit plus la reformater.

    .exe : commande = chemin entre guillemets, process_name = son propre nom.
    .lnk : commande = cible résolue entre guillemets, process_name = nom de
           la cible (vide si la cible n'a pas d'extension, ex: raccourci
           vers un dossier — cas très rare pour une "app").
    .url : commande = `start "" "<url>"` (nécessaire pour qu'un protocole
           personnalisé comme steam://rungameid/<id> s'ouvre réellement —
           un lancement direct sans `start` échoue, cmd.exe ne sachant pas
           résoudre un protocole autrement), process_name = "" (aucun nom
           d'exécutable fiable à en tirer, le jeu réel lancé par Steam
           n'est pas connu à l'avance — l'app apparaîtra donc toujours
           comme "non détectée comme déjà ouverte", cf. process_names vide
           dans shortcuts_config.json).
    """
    p = Path(path)
    suffix = p.suffix.lower()

    if suffix == ".lnk":
        shell = win32com.client.Dispatch("WScript.Shell")
        shortcut = shell.CreateShortCut(str(p))
        target = shortcut.TargetPath or str(p)
        target_p = Path(target)
        # Arguments du raccourci (ex: --remote-debugging-port=9222 pour le
        # raccourci Deezer CDP créé par create_deezer_shortcut.bat) — sans
        # ça, l'app se lance bien mais SANS l'option qui la fait fonctionner
        # correctement avec Cockpit OS (contrôle lecture/shuffle/repeat via
        # CDP pour Deezer). Bug confirmé le 2026-09-14 : un .lnk avec
        # arguments perdait silencieusement ces arguments à l'ajout.
        args = (shortcut.Arguments or "").strip()
        command = f'"{target}"' + (f" {args}" if args else "")
        return command, p.stem, (target_p.name if target_p.suffix else "")

    if suffix == ".url":
        info = _parse_url_shortcut(str(p))
        url = info["url"] or str(p)
        return f'start "" "{url}"', p.stem, ""

    # .exe (ou tout autre exécutable direct)
    return f'"{p}"', p.stem, p.name
