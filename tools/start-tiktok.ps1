[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Username)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$dataOverride = $env:GTA_CHAOS_DATA
$data = if ([string]::IsNullOrWhiteSpace($dataOverride)) { Join-Path $workspace 'data' } else { $dataOverride }
$logs = Join-Path $data 'logs'
$statePath = Join-Path $data 'tiktok-process.json'
$connector = Join-Path $workspace 'services\tiktok-connector\connector.py'
if ([string]::IsNullOrWhiteSpace($Username)) { throw 'Debe indicar un username de TikTok.' }
if ([string]::IsNullOrWhiteSpace($env:CHAOS_TOKEN)) { throw 'CHAOS_TOKEN es obligatorio para iniciar el conector TikTok.' }
$normalizedUsername = $Username.Trim().TrimStart('@')
if ([string]::IsNullOrWhiteSpace($normalizedUsername)) { throw 'Debe indicar un username de TikTok válido.' }
$runtime = Join-Path $workspace 'runtime'
if (-not (Test-Path -LiteralPath $runtime -PathType Container)) {
  $developmentRuntime = Join-Path $workspace 'apps\desktop\src-tauri\runtime'
  if (Test-Path -LiteralPath $developmentRuntime -PathType Container) { $runtime = $developmentRuntime }
}
$packagedConnector = Join-Path $runtime 'tiktok-connector.exe'
if (Test-Path -LiteralPath $packagedConnector -PathType Leaf) {
  $launcher = $packagedConnector
  $arguments = @($normalizedUsername)
} else {
  $python = Join-Path $workspace '.venv-tiktok\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "No se encontró el Python del conector: $python" }
  if (-not (Test-Path -LiteralPath $connector -PathType Leaf)) { throw "No se encontró connector.py: $connector" }
  $launcher = $python
  $arguments = @($connector, $normalizedUsername)
}
if (Test-Path -LiteralPath $statePath) {
  $old = Get-Content -Raw $statePath | ConvertFrom-Json
  if (Get-Process -Id $old.pid -ErrorAction SilentlyContinue) { throw 'El conector TikTok ya está activo; deténgalo primero.' }
  Remove-Item -LiteralPath $statePath -Force
}
New-Item -ItemType Directory -Force -Path $data, $logs | Out-Null
$stdout = Join-Path $logs 'tiktok.out.log'
$stderr = Join-Path $logs 'tiktok.err.log'
$proc = Start-Process -FilePath $launcher -ArgumentList $arguments -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
[ordered]@{ pid = $proc.Id; username = $normalizedUsername; stdout = $stdout; stderr = $stderr } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Output "Conector TikTok iniciado para @$normalizedUsername. PID: $($proc.Id)"
