# Uso: powershell -ExecutionPolicy RemoteSigned -File .\scripts\android-aab.ps1
# Compila el AAB firmado para Google Play. Las contraseñas se piden ocultas y
# sólo viven en este proceso; nunca se guardan en archivos ni en el historial.
[CmdletBinding()]
param(
    [string]$Keystore = (Join-Path (Split-Path -Parent $PSScriptRoot) 'planifia-release.keystore'),
    [string]$Alias = 'planifia'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path -LiteralPath $Keystore -PathType Leaf)) {
    throw "No se encontro la clave de carga en $Keystore. Indica otra ruta con -Keystore."
}
function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    return [System.Net.NetworkCredential]::new('', $secure).Password
}
$storePassword = Read-Secret 'Contrasena del almacen (keystore)'
$keyPassword = Read-Secret 'Contrasena de la clave (Enter si es la misma)'
if (-not $keyPassword) { $keyPassword = $storePassword }

$names = 'PLANIFIA_ANDROID_KEYSTORE', 'PLANIFIA_ANDROID_STORE_PASSWORD', 'PLANIFIA_ANDROID_KEY_ALIAS', 'PLANIFIA_ANDROID_KEY_PASSWORD'
try {
    $env:PLANIFIA_ANDROID_KEYSTORE = (Resolve-Path -LiteralPath $Keystore).Path
    $env:PLANIFIA_ANDROID_STORE_PASSWORD = $storePassword
    $env:PLANIFIA_ANDROID_KEY_ALIAS = $Alias
    $env:PLANIFIA_ANDROID_KEY_PASSWORD = $keyPassword
    Push-Location $repoPath
    & npm.cmd run android:aab
    if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo (codigo $LASTEXITCODE). Revisa los mensajes anteriores." }
    $aab = Join-Path $repoPath 'src-tauri\gen\android\app\build\outputs\bundle\universalRelease\app-universal-release.aab'
    Write-Host ''
    Write-Host "AAB firmado listo para subir a Play Console:" -ForegroundColor Green
    Write-Host $aab
} finally {
    Pop-Location -ErrorAction SilentlyContinue
    foreach ($name in $names) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    $storePassword = $null
    $keyPassword = $null
}
