[CmdletBinding()]
param([switch]$Packaged)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$dataOverride = $env:GTA_CHAOS_DATA
$data = if ([string]::IsNullOrWhiteSpace($dataOverride)) { Join-Path $workspace 'data' } else { $dataOverride }
$logs = Join-Path $data 'logs'
$statePath = Join-Path $data 'local-processes.json'
New-Item -ItemType Directory -Force -Path $data, $logs | Out-Null
$env:CHAOS_DB = Join-Path $data 'chaos-live.db'

function Test-LocalPort([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(250)) { return $false }
    return $client.Connected
  } catch { return $false }
  finally { $client.Dispose() }
}

$portsToCheck = @(39177, 39178)
if (-not $Packaged) { $portsToCheck += 5173 }
$occupied = @($portsToCheck | Where-Object { Test-LocalPort $_ })
if ($occupied.Count) { throw "Los puertos locales ya están ocupados: $($occupied -join ', '). Detenga el proceso existente antes de iniciar el sistema." }

if (Test-Path -LiteralPath $statePath) {
  $old = Get-Content -Raw $statePath | ConvertFrom-Json
  $alive = @($old | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
  if ($alive.Count) { throw 'Ya hay servicios GTA Chaos Live activos; use stop-local.ps1 primero.' }
}

$commands = @()
if ($Packaged) {
  $runtime = Join-Path $workspace 'runtime'
  if (-not (Test-Path -LiteralPath $runtime -PathType Container)) {
    $developmentRuntime = Join-Path $workspace 'apps\desktop\src-tauri\runtime'
    if (Test-Path -LiteralPath $developmentRuntime -PathType Container) { $runtime = $developmentRuntime }
  }
  $node = Join-Path $runtime 'node.exe'
  $orchestrator = Join-Path $runtime 'orchestrator.cjs'
  $overlay = Join-Path $runtime 'overlay-server.cjs'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $orchestrator -PathType Leaf) -or -not (Test-Path -LiteralPath $overlay -PathType Leaf)) {
    throw "No se encontró el runtime Node empaquetado en $runtime. Regenere la aplicación con pnpm --filter @gta-chaos/desktop tauri:build."
  }
  $env:OVERLAY_ROOT = Join-Path $workspace 'apps\overlay'
  $commands += @{ name = 'orchestrator'; launcher = $node; args = @('--enable-source-maps', $orchestrator) }
  $commands += @{ name = 'overlay'; launcher = $node; args = @('--enable-source-maps', $overlay) }
} else {
  $commands += @{ name = 'orchestrator'; launcher = 'pnpm.cmd'; args = @('--filter', '@gta-chaos/orchestrator', 'dev') }
  $commands += @{ name = 'overlay'; launcher = 'pnpm.cmd'; args = @('--filter', '@gta-chaos/overlay-server', 'dev') }
  # Vite resolves its root from the process working directory. The filtered
  # command was launched from the workspace root, producing / -> 404 and
  # broken /src/* imports. Run it with the dashboard package as its cwd.
  $commands += @{ name = 'dashboard'; launcher = 'pnpm.cmd'; args = @('--dir', (Join-Path $workspace 'apps\dashboard'), 'dev') }
}
$processes = @()
try {
  foreach ($entry in $commands) {
    $stdout = Join-Path $logs "$($entry.name).out.log"
    $stderr = Join-Path $logs "$($entry.name).err.log"
    $proc = Start-Process -FilePath $entry.launcher -ArgumentList $entry.args -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $processes += [pscustomobject]@{ name = $entry.name; pid = $proc.Id; stdout = $stdout; stderr = $stderr }
  }

  $deadline = (Get-Date).AddSeconds(8)
  do {
    $ready = @($portsToCheck | Where-Object { Test-LocalPort $_ }).Count -eq $portsToCheck.Count
    if ($ready) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  if (-not $ready) {
    $details = ($processes | ForEach-Object {
      $tail = if (Test-Path -LiteralPath $_.stderr) { (Get-Content -LiteralPath $_.stderr -Tail 8 -ErrorAction SilentlyContinue) -join ' ' } else { '' }
      "$($_.name): $tail"
    }) -join ' | '
    throw "Los servicios no alcanzaron los puertos esperados ($($portsToCheck -join ', ')). $details"
  }
} catch {
  foreach ($entry in $processes) {
    if (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue) { & taskkill.exe /PID $entry.pid /T /F | Out-Null }
  }
  throw
}
$processes | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Output "Servicios iniciados. Estado: $statePath"
$processes | Format-Table name, pid
