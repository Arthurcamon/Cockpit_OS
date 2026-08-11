@echo off
:: ═══════════════════════════════════════════════════════════════════════════
::  Cockpit OS — Créer le raccourci Deezer Desktop avec CDP activé
::  Lance ce script UNE FOIS pour créer un raccourci qui démarre Deezer avec
::  --remote-debugging-port=9222 (requis pour contrôler la lecture).
::
::  Prérequis : version .exe classique de Deezer Desktop (pas Microsoft Store)
:: ═══════════════════════════════════════════════════════════════════════════

setlocal EnableDelayedExpansion

echo.
echo  Cockpit OS — Raccourci Deezer Desktop avec CDP
echo  ════════════════════════════════════════════════
echo.

:: ── Chercher Deezer Desktop dans les emplacements courants ──────────────────
set "DEEZER_EXE="

if exist "%LOCALAPPDATA%\Programs\deezer-desktop\Deezer.exe" (
    set "DEEZER_EXE=%LOCALAPPDATA%\Programs\deezer-desktop\Deezer.exe"
    goto :found
)
if exist "%LOCALAPPDATA%\Deezer\Deezer.exe" (
    set "DEEZER_EXE=%LOCALAPPDATA%\Deezer\Deezer.exe"
    goto :found
)
if exist "%PROGRAMFILES%\Deezer\Deezer.exe" (
    set "DEEZER_EXE=%PROGRAMFILES%\Deezer\Deezer.exe"
    goto :found
)
if exist "%PROGRAMFILES(X86)%\Deezer\Deezer.exe" (
    set "DEEZER_EXE=%PROGRAMFILES(X86)%\Deezer\Deezer.exe"
    goto :found
)

:: Chemin non trouvé automatiquement
echo  Deezer Desktop introuvable dans les emplacements habituels.
echo.
echo  Si tu utilises la version Microsoft Store : elle n'est pas compatible.
echo  Installe la version .exe classique depuis https://www.deezer.com/download
echo.
set /p "DEEZER_EXE=Chemin vers Deezer.exe : "

:found
if not exist "!DEEZER_EXE!" (
    echo.
    echo  ERREUR : fichier introuvable — !DEEZER_EXE!
    pause
    exit /b 1
)
echo  OK  Deezer Desktop : !DEEZER_EXE!

:: ── Obtenir le vrai chemin du Bureau (fonctionne en FR, avec OneDrive, etc.) ──
for /f "usebackq delims=" %%D in (
    `powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`
) do set "DESKTOP=%%D"

echo  OK  Bureau : !DESKTOP!

set "SHORTCUT=!DESKTOP!\Deezer (Cockpit OS).lnk"

:: ── Créer le raccourci via PowerShell (chemin passé en variable, pas inline) ──
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$target = $env:DEEZER_EXE;" ^
  "$dest   = $env:SHORTCUT;" ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$sc = $ws.CreateShortcut($dest);" ^
  "$sc.TargetPath = $target;" ^
  "$sc.Arguments = '--remote-debugging-port=9222';" ^
  "$sc.WorkingDirectory = [IO.Path]::GetDirectoryName($target);" ^
  "$sc.Description = 'Deezer Desktop avec CDP pour Cockpit OS';" ^
  "$sc.Save();"

if errorlevel 1 (
    echo.
    echo  ERREUR : impossible de créer le raccourci.
    echo  Essaie de lancer ce script en tant qu'administrateur.
    pause
    exit /b 1
)

echo.
echo  OK  Raccourci créé : "!SHORTCUT!"
echo.
echo  ════════════════════════════════════════════════
echo   ÉTAPES SUIVANTES
echo  ════════════════════════════════════════════════
echo   1. Ferme Deezer Desktop s'il est ouvert.
echo   2. Lance Deezer via le nouveau raccourci
echo      "Deezer (Cockpit OS)" sur le bureau.
echo   3. Relance Cockpit OS (python main.py).
echo   4. Vérifie : http://localhost:8000/api/debug/deezer-player
echo      → deezer_target_found doit être true
echo  ════════════════════════════════════════════════
echo.
pause
