[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$dataOverride = $env:GTA_CHAOS_DATA
$data = if ([string]::IsNullOrWhiteSpace($dataOverride)) { Join-Path $workspace 'data' } else { $dataOverride }
$statePath = Join-Path $data 'tiktok-process.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No hay conector TikTok activo.'; exit 0 }
$state = Get-Content -Raw $statePath | ConvertFrom-Json
$proc = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if ($proc -and $PSCmdlet.ShouldProcess("TikTok [$($state.pid)]", 'Detener árbol de procesos')) { & taskkill.exe /PID $state.pid /T /F | Out-Null }
Remove-Item -LiteralPath $statePath -Force
Write-Output 'Conector TikTok detenido.'
