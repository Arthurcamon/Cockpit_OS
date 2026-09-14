@echo off
:: ═══════════════════════════════════════════════════════════════════════════
::  Cockpit OS — Lancement rapide
::  Double-clique ce fichier (ou son raccourci) pour ouvrir l'app compagnon.
::  C'est elle qui pilote le serveur (onglet Serveur : Lancer/Redemarrer/
::  Arreter, QR code de connexion tablette, logs en direct).
:: ═══════════════════════════════════════════════════════════════════════════

setlocal

:: Se placer dans le dossier du script, quel que soit l'endroit d'où il est lancé
cd /d "%~dp0"

title Cockpit OS — App compagnon

echo.
echo  Cockpit OS — Demarrage de l'app compagnon
echo  ════════════════════════════════════════════════
echo.

:: ── Verifie que Python est disponible ───────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo  ERREUR : Python est introuvable dans le PATH.
    echo  Installe Python depuis https://python.org puis reessaie.
    echo.
    pause
    exit /b 1
)

:: ── Verifie que les dependances du serveur sont installees ──────────────────
python -c "import fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
    echo  Dependances serveur manquantes — installation en cours...
    echo.
    pip install -r requirements.txt
    echo.
)

:: ── Verifie que les dependances de l'app compagnon sont installees ──────────
python -c "import customtkinter, tkinterdnd2, qrcode, icoextract, pystray, win32com.client, httpx, psutil" >nul 2>&1
if errorlevel 1 (
    echo  Dependances de l'app compagnon manquantes — installation en cours...
    echo.
    pip install -r companion_app\requirements.txt
    echo.
)

:: ── Lance l'app compagnon (fenetre graphique, sans console — pythonw) ───────
echo  Ouverture de l'app compagnon...
echo  (utilise l'onglet Serveur pour demarrer Cockpit OS et obtenir le QR
echo   code de connexion tablette)
echo.

start "" pythonw "%~dp0companion_app\main.py"

endlocal
exit /b 0
