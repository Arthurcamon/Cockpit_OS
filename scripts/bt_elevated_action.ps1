# Cockpit OS — actions élevées (Bluetooth PnP + adaptateur Wi-Fi)
#
# Exécuté par la tâche planifiée "CockpitOS_BluetoothHelper" (voir setup_admin_task.ps1)
# — nom historique : gère désormais aussi la bascule de l'adaptateur Wi-Fi, pas
# seulement le Bluetooth (voir services/wifi_service.py). Lit une demande d'action
# dans %TEMP%\cockpit_os_{pnp,wifi}_action.json, l'exécute avec les droits admin de
# la tâche, puis écrit le résultat dans le fichier *_result.json correspondant pour
# que le service Python (non élevé) puisse le relire. Fichiers distincts par type
# d'action pour qu'une demande Bluetooth et une demande Wi-Fi concurrentes ne se
# marchent jamais dessus.

$pnpActionFile = Join-Path $env:TEMP "cockpit_os_pnp_action.json"
$pnpResultFile = Join-Path $env:TEMP "cockpit_os_pnp_result.json"
$wifiActionFile = Join-Path $env:TEMP "cockpit_os_wifi_action.json"
$wifiResultFile = Join-Path $env:TEMP "cockpit_os_wifi_result.json"

if (Test-Path $pnpActionFile) {
    try {
        $req = Get-Content $pnpActionFile -Raw | ConvertFrom-Json
        $instanceId = $req.instance_id
        $action = $req.action

        $dev = Get-PnpDevice -InstanceId $instanceId -ErrorAction Stop
        if ($action -eq "enable") {
            $dev | Enable-PnpDevice -Confirm:$false -ErrorAction Stop
        } else {
            $dev | Disable-PnpDevice -Confirm:$false -ErrorAction Stop
        }

        Start-Sleep -Milliseconds 300
        $status = (Get-PnpDevice -InstanceId $instanceId -ErrorAction SilentlyContinue).Status
        @{ ok = $true; status = $status } | ConvertTo-Json | Set-Content -Path $pnpResultFile -Encoding UTF8
    }
    catch {
        @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -Path $pnpResultFile -Encoding UTF8
    }
    finally {
        Remove-Item $pnpActionFile -ErrorAction SilentlyContinue
    }
    exit 0
}

if (Test-Path $wifiActionFile) {
    try {
        $req = Get-Content $wifiActionFile -Raw | ConvertFrom-Json
        $enable = [bool]$req.enable

        $adapter = Get-NetAdapter -Physical | Where-Object { $_.MediaType -like '*802.11*' } | Select-Object -First 1
        if (-not $adapter) {
            throw "Aucun adaptateur Wi-Fi détecté"
        }
        if ($enable) {
            $adapter | Enable-NetAdapter -Confirm:$false -ErrorAction Stop
        } else {
            $adapter | Disable-NetAdapter -Confirm:$false -ErrorAction Stop
        }

        Start-Sleep -Milliseconds 500
        $status = (Get-NetAdapter -Name $adapter.Name -ErrorAction SilentlyContinue).Status
        @{ ok = $true; status = $status } | ConvertTo-Json | Set-Content -Path $wifiResultFile -Encoding UTF8
    }
    catch {
        @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -Path $wifiResultFile -Encoding UTF8
    }
    finally {
        Remove-Item $wifiActionFile -ErrorAction SilentlyContinue
    }
    exit 0
}

# Ni fichier d'action Bluetooth ni Wi-Fi trouvé (ex. appel schtasks /run
# orphelin) — rien à faire.
