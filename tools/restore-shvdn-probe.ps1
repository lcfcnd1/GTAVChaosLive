[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [string]$BackupPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I AUTHORIZE RESTORE OF SHVDN PROBE')] [string]$Consent,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$planPath = Join-Path $BackupPath 'probe-install-plan.json'
if (-not (Test-Path -LiteralPath $planPath -PathType Leaf)) { throw 'No se encontró probe-install-plan.json.' }
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
if (@(Get-Process -Name 'GTA5_Enhanced', 'GTA5' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GTA V debe estar cerrado antes de restaurar.' }
if (-not $Execute) { $plan | ConvertTo-Json -Depth 8; Write-Output 'Plan-only: no se restauró el probe.'; exit 0 }
if (-not $PSCmdlet.ShouldProcess($GtaPath, 'Restaurar SHVDN probe')) { exit 0 }
$destination = Join-Path $GtaPath 'scripts\GtaChaosLive.ShvdnProbe.cs'
$removed = Join-Path $BackupPath 'removed-during-restore\GtaChaosLive.ShvdnProbe.cs'
if (Test-Path -LiteralPath $destination -PathType Leaf) {
  New-Item -ItemType Directory -Force -Path (Split-Path $removed -Parent) | Out-Null
  Move-Item -LiteralPath $destination -Destination $removed -Force
}
if ($plan.previousFileExists) {
  $previous = Join-Path $BackupPath 'previous\GtaChaosLive.ShvdnProbe.cs'
  if (-not (Test-Path -LiteralPath $previous -PathType Leaf)) { throw 'Falta el backup previo del probe.' }
  Copy-Item -LiteralPath $previous -Destination $destination -Force
}
Write-Output "Restauración completada. Archivo instalado conservado en: $removed"
