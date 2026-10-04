# Uso: powershell -ExecutionPolicy RemoteSigned -File .\scripts\start-services.ps1 [-LocalWeb]
[CmdletBinding()]
param([switch]$LocalWeb)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$gatewayPath = Join-Path $PSScriptRoot 'ollama-gateway.js'
$gatewayEnvPath = Join-Path $repoPath '.env.gateway.local'
$tunnelConfigPath = Join-Path $repoPath '.cloudflared\planifia-seller-ia.yml'
$tunnelCredentialsPath = Join-Path $repoPath '.cloudflared\planifia-seller-ia.json'
$vitePath = Join-Path $repoPath 'node_modules\vite\bin\vite.js'
$publishedUrl = 'https://misterdarkno2-wq.github.io/PlanifIA_Seller/'

function Find-Executable {
    param([string]$Name, [string[]]$Fallbacks)
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    foreach ($candidate in $Fallbacks) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    throw "No se encontro $Name. Instala el programa o agrega su carpeta a PATH."
}

function Get-ServiceProcess {
    param([int]$Port, [string]$Name, [string]$ExecutableName, [string]$ScriptPath = '', [switch]$LoopbackOnly)
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $null }
    $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($processIds.Count -ne 1) { throw "El puerto $Port tiene varios procesos. No se iniciara $Name ni se detendra ningun proceso." }
    $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($processIds[0])"
    if (-not $serviceProcess) { throw "No se pudo identificar el proceso del puerto $Port. No se iniciara $Name." }
    $expectedScript = $ScriptPath.Replace('\', '/')
    $commandLine = [string]$serviceProcess.CommandLine
    $commandLine = $commandLine.Replace('\', '/')
    if (-not $serviceProcess -or $serviceProcess.Name -ne $ExecutableName -or
        ($ScriptPath -and $commandLine.IndexOf($expectedScript, [StringComparison]::OrdinalIgnoreCase) -lt 0)) {
        throw "El puerto $Port esta ocupado por otra aplicacion. No se iniciara $Name ni se detendra ningun proceso."
    }
    if ($LoopbackOnly -and @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count -gt 0) {
        throw "$Name debe escuchar solamente en 127.0.0.1 o ::1. No se iniciara el tunel."
    }
    return $serviceProcess
}

function Get-HttpStatus {
    param([string]$Url, [string]$Method = 'GET')
    try {
        $options = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 2; MaximumRedirection = 0 }
        if ($Method -eq 'POST') { $options.Body = '{}'; $options.ContentType = 'application/json' }
        return [int](Invoke-WebRequest @options).StatusCode
    } catch {
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

function Test-Ollama {
    try {
        $version = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2
        return [bool]($version.PSObject.Properties['version'] -and $version.version)
    } catch { return $false }
}

function Wait-Service {
    param([scriptblock]$Probe, [int]$Seconds, [string]$Name, $StartedProcess)
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (& $Probe) { return }
        if ($StartedProcess) {
            $StartedProcess.Refresh()
            if ($StartedProcess.HasExited) { throw "$Name termino al iniciar. Revisa sus archivos .log en $repoPath." }
        }
        Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Name no respondio en $Seconds segundos. Revisa sus archivos .log en $repoPath. No se detuvo ningun proceso."
}

function Start-HiddenService {
    param([string]$Executable, [string[]]$Arguments, [string]$LogName)
    return Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $repoPath -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $repoPath "$LogName.stdout.log") `
        -RedirectStandardError (Join-Path $repoPath "$LogName.stderr.log") -PassThru
}

foreach ($required in @($gatewayPath, $gatewayEnvPath, $tunnelConfigPath, $tunnelCredentialsPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Falta $required. Configura el adaptador y el tunel siguiendo README.md antes de iniciar los servicios."
    }
}
if ($LocalWeb -and -not (Test-Path -LiteralPath $vitePath -PathType Leaf)) {
    throw 'Faltan las dependencias de la web. Ejecuta npm ci en la carpeta PlanifIA_Seller.'
}

$nodeExe = Find-Executable 'node' @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
$ollamaExe = Find-Executable 'ollama' @((Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'))
# La instalacion habitual de cloudflared en Windows esta en Program Files (x86).
$cloudflaredExe = Find-Executable 'cloudflared' @((Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'))

# Comprobar todos los puertos antes de iniciar nada; nunca reutilizar otra aplicacion.
$ollamaProcess = Get-ServiceProcess 11434 'Ollama' 'ollama.exe'
$gatewayProcess = Get-ServiceProcess 8012 'Adaptador Seller' 'node.exe' $gatewayPath -LoopbackOnly
$webProcess = $null
if ($LocalWeb) { $webProcess = Get-ServiceProcess 5173 'Web local Seller' 'node.exe' $vitePath -LoopbackOnly }

if (-not $ollamaProcess) { $ollamaProcess = Start-HiddenService $ollamaExe @('serve') 'seller-ollama' }
$ollamaId = if ($ollamaProcess.PSObject.Properties['ProcessId']) { $ollamaProcess.ProcessId } else { $ollamaProcess.Id }
Wait-Service { Test-Ollama } 20 'Ollama' (Get-Process -Id $ollamaId -ErrorAction SilentlyContinue)
Write-Host "Ollama disponible en 127.0.0.1:11434 (PID $ollamaId)."

if (-not $gatewayProcess) { $gatewayProcess = Start-HiddenService $nodeExe @(('"' + $gatewayPath + '"')) 'seller-gateway' }
$gatewayId = if ($gatewayProcess.PSObject.Properties['ProcessId']) { $gatewayProcess.ProcessId } else { $gatewayProcess.Id }
Wait-Service { (Get-HttpStatus 'http://127.0.0.1:8012/v1/chat/completions' 'POST') -eq 401 } 15 'Adaptador Seller' (Get-Process -Id $gatewayId -ErrorAction SilentlyContinue)
$null = Get-ServiceProcess 8012 'Adaptador Seller' 'node.exe' $gatewayPath -LoopbackOnly
Write-Host "Adaptador disponible en 127.0.0.1:8012 (PID $gatewayId). Solicitud sin Bearer rechazada con 401."

# Solo buscar el conector de este repositorio; el tunel anterior no se modifica.
$normalizedConfig = $tunnelConfigPath.Replace('\', '/')
$sellerConnectors = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object {
    $line = ([string]$_.CommandLine).Replace('\', '/')
    $line.IndexOf($normalizedConfig, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $line -match '\brun\s+"?(planifia-seller-ia|d59ecc8d-8021-429a-9e75-158f91ac06ec)\b'
})
if ($sellerConnectors.Count -gt 0) {
    Write-Host "Tunel Seller ya iniciado (PID $($sellerConnectors[0].ProcessId))."
} else {
    & $cloudflaredExe tunnel --config $tunnelConfigPath ingress validate | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'La configuracion del tunel Seller no es valida. No se iniciara el conector.' }
    $connector = Start-HiddenService $cloudflaredExe @('tunnel', '--config', ('"' + $tunnelConfigPath + '"'), 'run', 'planifia-seller-ia') 'seller-tunnel'
    Start-Sleep -Seconds 2
    $connector.Refresh()
    if ($connector.HasExited) { throw 'El tunel Seller termino al iniciar. Revisa seller-tunnel.stderr.log.' }
    Write-Host "Tunel Seller iniciado (PID $($connector.Id))."
}

if ($LocalWeb) {
    if (-not $webProcess) {
        $webProcess = Start-HiddenService $nodeExe @(('"' + $vitePath + '"'), '--host', '127.0.0.1', '--port', '5173', '--strictPort') 'seller-web'
    }
    $webId = if ($webProcess.PSObject.Properties['ProcessId']) { $webProcess.ProcessId } else { $webProcess.Id }
    Wait-Service { (Get-HttpStatus 'http://127.0.0.1:5173/') -eq 200 } 15 'Web local Seller' (Get-Process -Id $webId -ErrorAction SilentlyContinue)
    Write-Host "Web local: http://127.0.0.1:5173/ (PID $webId)."
}

Write-Host "Aplicacion: $publishedUrl"
Write-Host 'Los servicios quedan en segundo plano. No necesitas mantener esta terminal abierta.'
Write-Host "Los registros .log se guardan en $repoPath."
