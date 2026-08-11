"""
Cockpit OS — Script de diagnostic Windows Media Session
Lancez ce script directement sur votre PC Windows pour voir ce que winsdk détecte.

Usage :
    python debug_media.py

Ce script ne modifie rien, il lit seulement l'état actuel.
"""

import asyncio
import sys
import platform

print("=" * 60)
print("  Cockpit OS — Diagnostic Windows Media Session")
print("=" * 60)
print(f"  Système : {platform.system()} {platform.version()}")
print(f"  Python  : {sys.version}")
print()

if platform.system() != "Windows":
    print("❌ Ce script doit être lancé sur Windows.")
    sys.exit(1)

# Test import winsdk
try:
    from winsdk.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    )
    print("✅ winsdk importé avec succès")
except ImportError as e:
    print(f"❌ winsdk non installé : {e}")
    print("   → Installez-le avec : pip install winsdk")
    sys.exit(1)

# Test import pycaw
try:
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    from comtypes import CLSCTX_ALL
    PYCAW_OK = True
    print("✅ pycaw importé avec succès")
except ImportError as e:
    PYCAW_OK = False
    print(f"⚠️  pycaw non installé (audio Windows désactivé) : {e}")

print()


async def list_media_sessions():
    print("─" * 60)
    print("  Sessions Windows Media Session")
    print("─" * 60)

    try:
        manager = await MediaManager.request_async()
        print("✅ MediaManager.request_async() OK")
    except Exception as e:
        print(f"❌ MediaManager.request_async() a échoué : {e}")
        return

    # Session courante
    print()
    try:
        current = manager.get_current_session()
        if current:
            source = getattr(current, "source_app_user_model_id", "?")
            print(f"  Session COURANTE : {source}")
            try:
                info = await current.try_get_media_properties_async()
                print(f"    Titre   : {info.title!r}")
                print(f"    Artiste : {info.artist!r}")
                print(f"    Album   : {info.album_title!r}")
            except Exception as e:
                print(f"    ⚠️  Impossible de lire les propriétés : {e}")
            try:
                pb = current.get_playback_info()
                status_map = {0: "stopped", 1: "paused", 2: "playing"}
                val = getattr(getattr(pb, "playback_status", None), "value", -1)
                print(f"    Statut  : {status_map.get(val, f'inconnu ({val})')}")
            except Exception as e:
                print(f"    ⚠️  Impossible de lire le statut : {e}")
        else:
            print("  ⚠️  Aucune session courante (rien ne joue en ce moment ?)")
    except Exception as e:
        print(f"  ❌ get_current_session() a échoué : {e}")

    # Toutes les sessions
    print()
    print("  Toutes les sessions disponibles :")
    try:
        sessions = manager.get_sessions()

        # Essaie d'itérer
        count = 0
        try:
            count = len(sessions)
        except TypeError:
            # IVectorView sans __len__
            try:
                count = sessions.size
            except Exception:
                count = 0

        if count == 0:
            print("    (aucune session détectée)")
        else:
            for i in range(count):
                try:
                    if hasattr(sessions, '__getitem__'):
                        s = sessions[i]
                    else:
                        s = sessions.get_at(i)
                    source = getattr(s, "source_app_user_model_id", "?")
                    print(f"  [{i}] {source}")
                    info = await s.try_get_media_properties_async()
                    print(f"      Titre   : {info.title!r}")
                    print(f"      Artiste : {info.artist!r}")
                except Exception as e:
                    print(f"  [{i}] ❌ Erreur : {e}")

    except Exception as e:
        print(f"  ❌ get_sessions() a échoué : {e}")
        print("     (certaines versions de winsdk ont des limitations sur get_sessions)")


def test_pycaw():
    if not PYCAW_OK:
        return
    print()
    print("─" * 60)
    print("  Audio Windows (pycaw)")
    print("─" * 60)
    try:
        speakers = AudioUtilities.GetSpeakers()
        # Compatibilité wrapper AudioDevice
        if hasattr(speakers, '_dev'):
            speakers = speakers._dev
        interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        vol_ctrl = interface.QueryInterface(IAudioEndpointVolume)
        vol = vol_ctrl.GetMasterVolumeLevelScalar()
        muted = vol_ctrl.GetMute()
        print(f"  ✅ Volume principal : {round(vol * 100)}%  {'(muet)' if muted else ''}")
    except Exception as e:
        print(f"  ❌ Erreur volume : {e}")

    try:
        sessions = AudioUtilities.GetAllSessions()
        apps = [(s.Process.name(), round(s.SimpleAudioVolume.GetMasterVolume() * 100))
                for s in sessions if s.Process]
        print(f"  Applications audio : {apps if apps else '(aucune)'}")
    except Exception as e:
        print(f"  ❌ Erreur applications audio : {e}")


if __name__ == "__main__":
    asyncio.run(list_media_sessions())
    test_pycaw()
    print()
    print("─" * 60)
    print("  Si tout est ✅ mais Cockpit OS n'affiche rien :")
    print("  → Ouvrez http://localhost:8000/api/debug/media")
    print("    (avec le serveur lancé) pour voir le détail en JSON")
    print("─" * 60)
