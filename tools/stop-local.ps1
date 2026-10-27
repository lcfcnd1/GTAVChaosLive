[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$dataOverride = $env:GTA_CHAOS_DATA
$data = if ([string]::IsNullOrWhiteSpace($dataOverride)) { Join-Path $workspace 'data' } else { $dataOverride }
$statePath = Join-Path $data 'local-processes.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No hay estado de servicios local.'; exit 0 }
$processes = Get-Content -Raw $statePath | ConvertFrom-Json
foreach ($entry in $processes) {
  $proc = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if ($proc -and $PSCmdlet.ShouldProcess("$($entry.name) [$($entry.pid)]", 'Detener árbol de procesos')) {
    & taskkill.exe /PID $entry.pid /T /F | Out-Null
  }
}
Remove-Item -LiteralPath $statePath -Force
Write-Output 'Servicios locales detenidos.'
