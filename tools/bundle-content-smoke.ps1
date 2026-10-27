[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $workspace 'apps/desktop/src-tauri/tauri.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$resourceText = $config.bundle.resources | ConvertTo-Json -Compress
$requiredMarkers = @('runtime/*', 'GtaChaosLive.dll', 'GtaChaosLive.build.json', 'services/orchestrator/package.json', 'services/tiktok-connector/*.py', 'apps/overlay/*')
foreach ($marker in $requiredMarkers) {
  if ($resourceText -notmatch [regex]::Escape($marker)) { throw "Recurso ausente en tauri.conf.json: $marker" }
}
$runtime = Join-Path $workspace 'apps/desktop/src-tauri/runtime'
foreach ($file in @('node.exe', 'orchestrator.cjs', 'overlay-server.cjs', 'profile-cli.cjs', 'tiktok-connector.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $runtime $file) -PathType Leaf)) { throw "Runtime ausente: $file" }
}
$nsis = Join-Path $workspace 'apps/desktop/src-tauri/target/release/nsis/x64/installer.nsi'
if (-not (Test-Path -LiteralPath $nsis -PathType Leaf)) { throw 'No existe el script NSIS generado.' }
$nsisText = Get-Content -LiteralPath $nsis -Raw
foreach ($marker in @('runtime\node.exe', 'runtime\orchestrator.cjs', 'runtime\overlay-server.cjs', 'runtime\tiktok-connector.exe', 'mods\gta-chaos-live\bin\GtaChaosLive.dll', 'mods\gta-chaos-live\bin\GtaChaosLive.build.json')) {
  if ($nsisText -notmatch [regex]::Escape($marker)) { throw "El instalador NSIS no incluye: $marker" }
}
foreach ($bundle in @(
  'apps/desktop/src-tauri/target/release/bundle/nsis/GTA Chaos Live_0.1.0_x64-setup.exe',
  'apps/desktop/src-tauri/target/release/bundle/msi/GTA Chaos Live_0.1.0_x64_en-US.msi'
)) {
  if (-not (Test-Path -LiteralPath (Join-Path $workspace $bundle) -PathType Leaf)) { throw "Bundle ausente: $bundle" }
}
[pscustomobject]@{ status = 'passed'; resources = 'declared'; runtime = 'present'; nsis = 'references_required_components'; installers = 'present' } | ConvertTo-Json -Compress
