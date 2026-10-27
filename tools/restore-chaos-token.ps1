[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [string]$BackupPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I AUTHORIZE RESTORE OF CHAOS TOKEN')] [string]$Consent,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$planPath = Join-Path $BackupPath 'token-install-plan.json'
if (-not (Test-Path -LiteralPath $planPath -PathType Leaf)) { throw 'No se encontró token-install-plan.json.' }
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
if (@(Get-Process -Name 'GTA5_Enhanced', 'GTA5' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GTA V debe estar cerrado antes de restaurar el token.' }
if (-not $Execute) { $plan | ConvertTo-Json -Depth 8; Write-Output 'Plan-only: no se restauró el token.'; exit 0 }
if (-not $PSCmdlet.ShouldProcess($GtaPath, 'Restaurar token local')) { exit 0 }
$destination = Join-Path $GtaPath 'scripts\gta-chaos-live.token'
if ($plan.previousFileExists) {
  $previous = Join-Path $BackupPath 'previous\gta-chaos-live.token'
  if (-not (Test-Path -LiteralPath $previous -PathType Leaf)) { throw 'Falta el backup previo del token.' }
  Copy-Item -LiteralPath $previous -Destination $destination -Force
} elseif (Test-Path -LiteralPath $destination -PathType Leaf) {
  Remove-Item -LiteralPath $destination -Force
}
Write-Output 'Restauración del token completada sin mostrar su contenido.'
