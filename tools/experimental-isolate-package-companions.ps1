[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [string]$ManifestPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I AUTHORIZE ISOLATION OF XINPUT1_4 AND ARGS')] [string]$Consent,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$names = @('xinput1_4.dll', 'args.txt')
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$records = foreach ($name in $names) {
  $path = Join-Path $GtaPath $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No existe el archivo objetivo: $path" }
  $entry = @($manifest.game.manualInstalledFiles | Where-Object { $_.name -eq $name }) | Select-Object -First 1
  if (-not $entry) { throw "El manifiesto no registra $name." }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($hash -ne ([string]$entry.sha256).ToUpperInvariant()) { throw "Hash inesperado para ${name}: no se retira." }
  [pscustomobject]@{ name = $name; source = $path; sha256 = $hash }
}

if (@(Get-Process -Name 'GTA5_Enhanced', 'GTA5' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GTA V debe estar cerrado antes del aislamiento.' }
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backupRoot = Join-Path $GtaPath "GtaChaosLive.experimental-isolation.$timestamp"
$plan = [ordered]@{ mode = 'reversible-companion-isolation'; gamePath = (Resolve-Path $GtaPath).Path; backupRoot = $backupRoot; files = $records; executeRequested = [bool]$Execute; antiCheatArgumentsRemoved = $true }
if (-not $Execute) { $plan | ConvertTo-Json -Depth 8; Write-Output 'Plan-only: no se retiró ningún archivo.'; exit 0 }
if (-not $PSCmdlet.ShouldProcess($GtaPath, 'Aislar temporalmente xinput1_4.dll y args.txt')) { exit 0 }
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$plan | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupRoot 'isolation-plan.json') -Encoding UTF8
foreach ($record in $records) {
  Copy-Item -LiteralPath $record.source -Destination (Join-Path $backupRoot $record.name) -Force
  $backupHash = (Get-FileHash -LiteralPath (Join-Path $backupRoot $record.name) -Algorithm SHA256).Hash
  if ($backupHash -ne $record.sha256) { throw "Verificación de backup fallida para $($record.name)." }
  Remove-Item -LiteralPath $record.source -Force
}
Write-Output "Aislamiento completado. Copias verificadas en: $backupRoot"
