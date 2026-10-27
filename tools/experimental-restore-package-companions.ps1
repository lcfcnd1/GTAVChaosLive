[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [string]$BackupPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I AUTHORIZE RESTORE OF XINPUT1_4 AND ARGS')] [string]$Consent,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$planPath = Join-Path $BackupPath 'isolation-plan.json'
if (-not (Test-Path -LiteralPath $planPath -PathType Leaf)) { throw 'No se encontró isolation-plan.json.' }
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
if (@(Get-Process -Name 'GTA5_Enhanced', 'GTA5' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GTA V debe estar cerrado antes de restaurar.' }
if (-not $Execute) { $plan | ConvertTo-Json -Depth 8; Write-Output 'Plan-only: no se restauró ningún archivo.'; exit 0 }
if (-not $PSCmdlet.ShouldProcess($GtaPath, 'Restaurar xinput1_4.dll y args.txt')) { exit 0 }
foreach ($record in $plan.files) {
  $backupFile = Join-Path $BackupPath $record.name
  $destination = Join-Path $GtaPath $record.name
  if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf)) { throw "Falta backup de $($record.name)." }
  $backupHash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash
  if ($backupHash -ne $record.sha256) { throw "Hash de backup inválido para $($record.name)." }
  Copy-Item -LiteralPath $backupFile -Destination $destination -Force
  $restoredHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
  if ($restoredHash -ne $record.sha256) { throw "Hash restaurado inválido para $($record.name)." }
}
Write-Output 'Restauración completada y verificada.'
