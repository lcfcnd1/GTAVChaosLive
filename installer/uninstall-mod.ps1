[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I UNDERSTAND STORY MODE ONLY')] [string]$Consent,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $GtaPath -PathType Container)) { throw "La ruta no existe: $GtaPath" }
$destination = Join-Path $GtaPath 'scripts\GtaChaosLive.dll'
$tokenDestination = Join-Path $GtaPath 'scripts\gta-chaos-live.token'
if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { Write-Output 'GtaChaosLive.dll no está instalado.'; exit 0 }

$source = Join-Path $PSScriptRoot '..\mods\gta-chaos-live\bin\GtaChaosLive.dll'
if (-not $Force -and (Test-Path -LiteralPath $source -PathType Leaf)) {
  $installedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
  $currentHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if ($installedHash -ne $currentHash) { throw 'El DLL instalado no coincide con el build local; use -Force solo si confirmó que es el archivo propio.' }
}

$backup = "$destination.removed.$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')).bak"
Move-Item -LiteralPath $destination -Destination $backup -Force
Write-Output "Desinstalado. Backup recuperable: $backup"
if (Test-Path -LiteralPath $tokenDestination -PathType Leaf) {
  $tokenBackup = "$tokenDestination.removed.$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')).bak"
  Move-Item -LiteralPath $tokenDestination -Destination $tokenBackup -Force
  Write-Output "Token local removido. Backup recuperable: $tokenBackup"
}
