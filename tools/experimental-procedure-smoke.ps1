[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
foreach ($path in @(
  (Join-Path $workspace 'installer/experimental-install.ps1'),
  (Join-Path $workspace 'installer/experimental-restore.ps1')
)) {
  [scriptblock]::Create((Get-Content -LiteralPath $path -Raw)) | Out-Null
}
$manifest = Get-Content -LiteralPath (Join-Path $workspace 'installer/experimental-manifest.example.json') -Raw | ConvertFrom-Json
if ([string]$manifest.gameVersion -ne '1.0.1158.16') { throw 'El manifiesto experimental no fija el patch esperado.' }
$mainInstaller = Get-Content -LiteralPath (Join-Path $workspace 'installer/install-mod.ps1') -Raw
if ($mainInstaller -notmatch 'No hay compatibilidad oficial registrada') { throw 'El instalador principal perdió el bloqueo de patch no verificado.' }
$experimentalInstaller = Get-Content -LiteralPath (Join-Path $workspace 'installer/experimental-install.ps1') -Raw
if ($experimentalInstaller -notmatch '\[switch\]\$Execute' -or $experimentalInstaller -notmatch 'I UNDERSTAND EXPERIMENTAL STORY MODE ONLY') { throw 'El procedimiento experimental no exige barreras explícitas.' }
if ($experimentalInstaller -match "ScriptHookV = @\('ScriptHookV\.dll', 'dinput8\.dll', 'NativeTrainer\.asi'\)") { throw 'NativeTrainer.asi no debe ser obligatorio.' }
if ($experimentalInstaller -notmatch "ScriptHookV = @\('ScriptHookV\.dll', 'dinput8\.dll'\)") { throw 'La fase ScriptHookV no declara exactamente los dos archivos requeridos del loader.' }
if ($experimentalInstaller -notmatch "NativeTrainer = @\('NativeTrainer\.asi'\)") { throw 'La fase NativeTrainer aislada no está disponible.' }
[pscustomobject]@{ status = 'passed'; gameVersion = $manifest.gameVersion; gameFilesModified = $false; mainInstallerSecurityPreserved = $true; executeBarrier = $true } | ConvertTo-Json -Compress
