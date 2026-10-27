[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)] [ValidateSet('ScriptHookV', 'NativeTrainer', 'ScriptHookVDotNet')] [string]$Phase,
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [string]$PackagePath,
  [Parameter(Mandatory = $true)] [string]$ManifestPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I UNDERSTAND EXPERIMENTAL STORY MODE ONLY')] [string]$Consent,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$expectedGameVersion = '1.0.1158.16'
$allowedScriptHookV = @('https://www.dev-c.com/', 'https://dev-c.com/')
$allowedShvdn = 'https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/releases/'
$phaseFiles = @{
  # NativeTrainer.asi is optional according to the official Script Hook V package.
  # It is deliberately excluded from the first loader test and is never required.
  ScriptHookV = @('ScriptHookV.dll', 'dinput8.dll')
  NativeTrainer = @('NativeTrainer.asi')
  ScriptHookVDotNet = @('ScriptHookVDotNet.asi', 'ScriptHookVDotNet2.dll', 'ScriptHookVDotNet3.dll', 'ScriptHookVDotNet.ini', 'MinHook.x64.dll')
}

function Test-File([string]$Path) { return Test-Path -LiteralPath $Path -PathType Leaf }
function Get-FileVersionOrNull([string]$Path) {
  if (-not (Test-File $Path)) { return $null }
  $raw = (Get-Item -LiteralPath $Path).VersionInfo.FileVersion
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw
}
function Test-AllowedSource([string]$Url, [string]$SelectedPhase) {
  if ($SelectedPhase -in @('ScriptHookV', 'NativeTrainer')) { return @($allowedScriptHookV | Where-Object { $Url.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 }
  return $Url.StartsWith($allowedShvdn, [StringComparison]::OrdinalIgnoreCase)
}

if (-not (Test-Path -LiteralPath $GtaPath -PathType Container)) { throw "La ruta de GTA no existe: $GtaPath" }
$gameExe = Join-Path $GtaPath 'GTA5_Enhanced.exe'
if (-not (Test-File $gameExe)) { throw 'No se encontró GTA5_Enhanced.exe.' }
$gameVersion = (Get-Item -LiteralPath $gameExe).VersionInfo.FileVersion
if ($gameVersion -ne $expectedGameVersion) { throw "La prueba experimental está fijada a $expectedGameVersion; se detectó $gameVersion." }
if (@(Get-Process -Name 'GTA5_Enhanced', 'GTA5' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GTA V debe estar cerrado antes de preparar o ejecutar la prueba.' }
if (-not (Test-Path -LiteralPath $PackagePath -PathType Container)) { throw "No existe el paquete preparado: $PackagePath" }
if (-not (Test-File $ManifestPath)) { throw "No existe el manifiesto de integridad: $ManifestPath" }
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ([string]$manifest.gameVersion -ne $expectedGameVersion) { throw 'El manifiesto no corresponde al patch experimental 1.0.1158.16.' }
if (-not $manifest.files) { throw 'El manifiesto no contiene archivos.' }

$records = @()
foreach ($name in $phaseFiles[$Phase]) {
  $entry = @($manifest.files | Where-Object { [string]$_.name -eq $name }) | Select-Object -First 1
  if (-not $entry) { throw "El manifiesto no declara $name." }
  if (-not (Test-AllowedSource ([string]$entry.sourceUrl) $Phase)) { throw "Procedencia no autorizada para ${name}: $($entry.sourceUrl)" }
  $source = Join-Path $PackagePath $name
  if (-not (Test-File $source)) { throw "Falta $name en el paquete preparado." }
  $actualHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if ($actualHash -ne ([string]$entry.sha256).ToUpperInvariant()) { throw "Hash inválido para $name." }
  $declaredVersion = [string]$entry.fileVersion
  $actualVersion = Get-FileVersionOrNull $source
  if ($declaredVersion -and $declaredVersion -ne $actualVersion) { throw "Versión inválida para ${name}: se esperaba $declaredVersion y se encontró $actualVersion." }
  $records += [pscustomobject]@{ name = $name; source = $source; destination = (Join-Path $GtaPath $name); sha256 = $actualHash; fileVersion = $actualVersion; sourceUrl = [string]$entry.sourceUrl }
}

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backupRoot = Join-Path $GtaPath ("GtaChaosLive.experimental-backup.$timestamp")
$plan = [ordered]@{
  mode = 'experimental-unverified-patch'
  phase = $Phase
  gamePath = (Resolve-Path -LiteralPath $GtaPath).Path
  gameExecutable = $gameExe
  gameVersion = $gameVersion
  backupRoot = $backupRoot
  files = $records
  storyModeOnly = $true
  onlineDisabledByProcedure = $true
  executeRequested = [bool]$Execute
}
if (-not $Execute) { $plan | ConvertTo-Json -Depth 6; Write-Output 'Plan-only: no se modificó la instalación. Agregue -Execute solo después de revisar el plan y autorizarlo.'; exit 0 }

if (-not $PSCmdlet.ShouldProcess($GtaPath, "Instalar fase experimental $Phase en Story Mode")) { exit 0 }
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
foreach ($record in $records) {
  if (Test-File $record.destination) {
    Copy-Item -LiteralPath $record.destination -Destination (Join-Path $backupRoot $record.name) -ErrorAction Stop
  }
}
$plan | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupRoot 'install-plan.json') -Encoding UTF8
foreach ($record in $records) { Copy-Item -LiteralPath $record.source -Destination $record.destination -Force -ErrorAction Stop }
Write-Output "Instalada fase experimental $Phase. Backup: $backupRoot"
Write-Output 'Esta prueba es únicamente Story Mode; no iniciar GTA Online.'
