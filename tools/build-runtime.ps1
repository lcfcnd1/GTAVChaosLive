[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $workspace 'apps\desktop\src-tauri\runtime'
$pnpmStore = Join-Path $workspace 'node_modules\.pnpm'
$esbuildPackage = Get-ChildItem -LiteralPath $pnpmStore -Directory -Filter 'esbuild@*' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $esbuildPackage) { throw 'No se encontró esbuild; ejecute pnpm install antes de generar el runtime empaquetado.' }
$esbuild = Join-Path $esbuildPackage.FullName 'node_modules\esbuild\bin\esbuild'
if (-not (Test-Path -LiteralPath $esbuild -PathType Leaf)) { throw "No se encontró el launcher de esbuild: $esbuild" }
$node = (Get-Command node.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $runtime | Out-Null
foreach ($stale in @('orchestrator.mjs', 'orchestrator.mjs.map', 'overlay-server.mjs', 'overlay-server.mjs.map')) {
  $stalePath = Join-Path $runtime $stale
  if (Test-Path -LiteralPath $stalePath -PathType Leaf) { Remove-Item -LiteralPath $stalePath -Force }
}
Copy-Item -LiteralPath $node -Destination (Join-Path $runtime 'node.exe') -Force
& $node $esbuild (Join-Path $workspace 'services\orchestrator\src\index.ts') '--bundle' '--platform=node' '--format=cjs' '--sourcemap=external' '--external:node:*' ('--outfile=' + (Join-Path $runtime 'orchestrator.cjs'))
if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el runtime del orquestador.' }
& $node $esbuild (Join-Path $workspace 'services\orchestrator\src\profile-cli.ts') '--bundle' '--platform=node' '--format=cjs' '--sourcemap=external' '--external:node:*' ('--outfile=' + (Join-Path $runtime 'profile-cli.cjs'))
if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el runtime de perfiles.' }
& $node $esbuild (Join-Path $workspace 'services\overlay-server\src\index.ts') '--bundle' '--platform=node' '--format=cjs' '--sourcemap=external' '--external:node:*' ('--outfile=' + (Join-Path $runtime 'overlay-server.cjs'))
if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el runtime del overlay.' }
$python = Join-Path $workspace '.venv-tiktok\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "No se encontró el entorno Python de TikTokLive: $python" }
$pyinstallerWork = Join-Path $workspace 'data\pyinstaller-build'
& $python '-m' 'PyInstaller' '--noconfirm' '--clean' '--onefile' '--name' 'tiktok-connector' '--distpath' $runtime '--workpath' $pyinstallerWork '--specpath' (Join-Path $workspace 'data') (Join-Path $workspace 'services\tiktok-connector\connector.py')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el runtime autónomo de TikTok.' }
Write-Output "Runtime empaquetado generado en $runtime"
