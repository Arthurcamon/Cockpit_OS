# Cockpit OS — configuration unique de la tâche planifiée élevée
#
# À exécuter UNE SEULE FOIS (double-clic sur setup_admin_task.bat), un prompt UAC
# s'affichera. Après ça, Cockpit OS peut déclencher des actions qui nécessitent
# des droits admin (connecter/déconnecter un appareil Bluetooth, activer/désactiver
# l'adaptateur Wi-Fi) sans jamais tourner lui-même en administrateur et sans autre
# prompt UAC.

$ErrorActionPreference = "Stop"

# Se relance élevé si besoin
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$actionScript = Join-Path $scriptDir "bt_elevated_action.ps1"

$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$actionScript`""

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest -LogonType Interactive

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -MultipleInstances Parallel

Register-ScheduledTask -TaskName "CockpitOS_BluetoothHelper" -Action $taskAction -Principal $principal -Settings $settings -Force | Out-Null

Write-Host ""
Write-Host "Tâche planifiée 'CockpitOS_BluetoothHelper' créée avec succès."
Write-Host "Le connect/disconnect Bluetooth et la bascule Wi-Fi de Cockpit OS peuvent maintenant fonctionner."
Write-Host ""
Read-Host "Appuyez sur Entrée pour fermer cette fenêtre"
