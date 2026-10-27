[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [string]$BackupPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I UNDERSTAND EXPERIMENTAL RESTORE')] [string]$Consent,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $GtaPath -PathType Container)) { throw "La ruta de GTA no existe: $GtaPath" }
if (@(Get-Process -Name 'GTA5_Enhanced', 'GTA5' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GTA V debe estar cerrado antes de restaurar.' }
$planPath = Join-Path $BackupPath 'install-plan.json'
if (-not (Test-Path -LiteralPath $planPath -PathType Leaf)) { throw 'No se encontró install-plan.json en el backup.' }
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$removedRoot = Join-Path $BackupPath 'removed-during-restore'
if (-not $Execute) { $plan | ConvertTo-Json -Depth 8; Write-Output 'Plan-only: no se modificó la instalación. Agregue -Execute para restaurar.'; exit 0 }
if (-not $PSCmdlet.ShouldProcess($GtaPath, 'Restaurar instalación experimental')) { exit 0 }
New-Item -ItemType Directory -Force -Path $removedRoot | Out-Null
foreach ($record in $plan.files) {
  $destination = Join-Path $GtaPath $record.name
  $backupFile = Join-Path $BackupPath $record.name
  if (Test-Path -LiteralPath $destination -PathType Leaf) { Move-Item -LiteralPath $destination -Destination (Join-Path $removedRoot $record.name) -Force }
  if (Test-Path -LiteralPath $backupFile -PathType Leaf) { Copy-Item -LiteralPath $backupFile -Destination $destination -Force }
}
Write-Output "Restauración completada. Archivos experimentales conservados en: $removedRoot"
