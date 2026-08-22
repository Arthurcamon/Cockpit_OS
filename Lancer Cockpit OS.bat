@echo off
:: ═══════════════════════════════════════════════════════════════════════════
::  Cockpit OS — Lancement rapide
::  Double-clique ce fichier (ou son raccourci) pour démarrer le serveur.
::  Puis ouvre http://localhost:8000 sur ta tablette (même réseau Wi-Fi).
:: ═══════════════════════════════════════════════════════════════════════════

setlocal

:: Se placer dans le dossier du script, quel que soit l'endroit d'où il est lancé
cd /d "%~dp0"

title Cockpit OS

echo.
echo  Cockpit OS — Demarrage
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

:: ── Verifie que les dependances sont installees (rapide, pas de reseau) ─────
python -c "import fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
    echo  Dependances manquantes — installation en cours...
    echo.
    pip install -r requirements.txt
    echo.
)

:: ── Ouvre l'interface dans le navigateur une fois le serveur pret ───────────
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:8000"

:: ── Lance le serveur (reste au premier plan pour voir les logs) ─────────────
echo  Serveur : http://localhost:8000
echo  (accessible depuis ta tablette sur le meme reseau Wi-Fi)
echo.
echo  Ctrl+C pour arreter Cockpit OS.
echo  ════════════════════════════════════════════════
echo.

python main.py

echo.
echo  Cockpit OS arrete.
pause
