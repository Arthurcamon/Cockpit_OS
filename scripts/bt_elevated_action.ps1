# Cockpit OS — action Bluetooth élevée
#
# Exécuté par la tâche planifiée "CockpitOS_BluetoothHelper" (voir setup_admin_task.ps1).
# Lit une demande d'action dans %TEMP%\cockpit_os_pnp_action.json, l'exécute avec les
# droits admin de la tâche, puis écrit le résultat dans %TEMP%\cockpit_os_pnp_result.json
# pour que le service Python (non élevé) puisse le relire.

$actionFile = Join-Path $env:TEMP "cockpit_os_pnp_action.json"
$resultFile = Join-Path $env:TEMP "cockpit_os_pnp_result.json"

try {
    if (-not (Test-Path $actionFile)) {
        @{ ok = $false; error = "no action file" } | ConvertTo-Json | Set-Content -Path $resultFile -Encoding UTF8
        exit 0
    }

    $req = Get-Content $actionFile -Raw | ConvertFrom-Json
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
    @{ ok = $true; status = $status } | ConvertTo-Json | Set-Content -Path $resultFile -Encoding UTF8
}
catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -Path $resultFile -Encoding UTF8
}
finally {
    Remove-Item $actionFile -ErrorAction SilentlyContinue
}
