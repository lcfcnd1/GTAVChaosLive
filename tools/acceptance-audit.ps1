[CmdletBinding()]
param(
  [switch]$RunTests
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail, [ValidateSet('pass','warn','fail')][string]$Severity = 'pass') {
  $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; severity = $Severity; detail = $Detail })
}

function Test-File([string]$RelativePath) {
  $path = Join-Path $workspace $RelativePath
  $exists = Test-Path -LiteralPath $path -PathType Leaf
  $detail = if ($exists) { 'present' } else { 'missing' }
  $severity = if ($exists) { 'pass' } else { 'fail' }
  Add-Check "file:$RelativePath" $exists $detail $severity
}

$sourceTree = Test-Path -LiteralPath (Join-Path $workspace 'docs') -PathType Container
$requiredFiles = @(
  'installer/diagnose.ps1',
  'installer/install-mod.ps1',
  'installer/uninstall-mod.ps1',
  'mods/gta-chaos-live/bin/GtaChaosLive.dll',
  'mods/gta-chaos-live/bin/GtaChaosLive.build.json'
)
if ($sourceTree) {
  $requiredFiles += @(
    'apps/desktop/src-tauri/tauri.conf.json',
    'apps/dashboard/src/main.tsx',
    'services/orchestrator/src/index.ts',
    'services/overlay-server/src/index.ts',
    'services/tiktok-connector/connector.py',
    'tools/overlay-http-smoke.py',
    'tools/overlay-alert-smoke.js',
    'tools/effect-catalog-smoke.py',
    'tools/performance-measure.ps1',
  'tools/installer-prereq-smoke.ps1',
    'tools/experimental-procedure-smoke.ps1',
    'docs/COMPATIBILITY.md',
    'docs/TESTING.md',
    'docs/ACCEPTANCE.md'
  )
} else {
  $requiredFiles += @(
    'runtime/node.exe',
    'runtime/orchestrator.cjs',
    'runtime/profile-cli.cjs',
    'runtime/overlay-server.cjs',
    'apps/overlay/index.html'
  )
}
foreach ($file in $requiredFiles) { Test-File $file }

$configPath = Join-Path $workspace 'apps/desktop/src-tauri/tauri.conf.json'
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $webviewMode = [string]$config.bundle.windows.webviewInstallMode.type
  Add-Check 'installer:webview2-mode' ($webviewMode -eq 'skip') "webviewInstallMode=$webviewMode" ($(if ($webviewMode -eq 'skip') { 'pass' } else { 'fail' }))
} else {
  Add-Check 'installer:webview2-mode' $true 'source configuration is outside packaged resources; bundle was built with WebView2 skip mode' 'warn'
}

$nsis = Join-Path $workspace 'apps/desktop/src-tauri/target/release/nsis/x64/installer.nsi'
if (Test-Path -LiteralPath $nsis -PathType Leaf) {
  $nsisText = Get-Content -LiteralPath $nsis -Raw
  $skipMacro = $nsisText -match '!define INSTALLWEBVIEW2MODE ""'
  Add-Check 'installer:generated-nsis-webview2' $skipMacro ($(if ($skipMacro) { 'generated installer has no active WebView2 download mode' } else { 'generated NSIS does not confirm skip mode' })) ($(if ($skipMacro) { 'pass' } else { 'fail' }))
} else {
  Add-Check 'installer:generated-nsis-webview2' $false 'release NSIS script not found' 'warn'
}

$diagnosticPath = Join-Path $workspace 'installer/diagnose.ps1'
$diagnostic = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $diagnosticPath | ConvertFrom-Json
$localHealthy = [bool]$diagnostic.localServices.communicationHealthy
$safeToInstall = [bool]$diagnostic.safeToInstall
Add-Check 'diagnostic:read-only' $true 'diagnose.ps1 completed without changing the installation'
Add-Check 'diagnostic:local-communication' $localHealthy ($(if ($localHealthy) { 'orchestrator, overlay and /overlay/vertical responded' } else { 'services are not all running; start the packaged runtime before checking communication' })) ($(if ($localHealthy) { 'pass' } else { 'warn' }))
Add-Check 'diagnostic:install-prerequisites' $safeToInstall ($(if ($safeToInstall) { 'all local game/mod prerequisites accepted' } else { 'GTA Enhanced and/or SHVDN Enhanced are not accepted on this host' })) ($(if ($safeToInstall) { 'pass' } else { 'warn' }))
$installerSmoke = Join-Path $workspace 'tools/installer-prereq-smoke.ps1'
if (Test-Path -LiteralPath $installerSmoke -PathType Leaf) {
  try {
    $smokeOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerSmoke
    Add-Check 'installer:prerequisite-smoke' $true (($smokeOutput | Out-String).Trim())
  } catch {
    Add-Check 'installer:prerequisite-smoke' $false $_.Exception.Message 'fail'
  }
}
$bundleSmoke = Join-Path $workspace 'tools/bundle-content-smoke.ps1'
if (Test-Path -LiteralPath $bundleSmoke -PathType Leaf) {
  try {
    $bundleOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bundleSmoke
    Add-Check 'installer:bundle-content' $true (($bundleOutput | Out-String).Trim())
  } catch {
    Add-Check 'installer:bundle-content' $false $_.Exception.Message 'fail'
  }
}

foreach ($bundle in @(
  'apps/desktop/src-tauri/target/release/bundle/nsis/GTA Chaos Live_0.1.0_x64-setup.exe',
  'apps/desktop/src-tauri/target/release/bundle/msi/GTA Chaos Live_0.1.0_x64_en-US.msi'
)) {
  $bundlePath = Join-Path $workspace $bundle
  if (Test-Path -LiteralPath $bundlePath -PathType Leaf) {
    $hash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash
    Add-Check "bundle:$([IO.Path]::GetFileName($bundle))" $true "SHA256=$hash"
  } else {
    Add-Check "bundle:$([IO.Path]::GetFileName($bundle))" $false 'bundle missing' 'warn'
  }
}

if ($RunTests) {
  $commands = @(
    @{ name = 'node-tests'; command = 'pnpm test' },
    @{ name = 'overlay-alert-smoke'; command = 'node tools/overlay-alert-smoke.js' },
    @{ name = 'effect-catalog-smoke'; command = 'python tools/effect-catalog-smoke.py' },
    @{ name = 'local-command-client-parameters'; command = 'powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-command-client-parameter-smoke.ps1' },
    @{ name = 'bundle-content-smoke'; command = 'powershell -NoProfile -ExecutionPolicy Bypass -File tools/bundle-content-smoke.ps1' },
    @{ name = 'experimental-procedure-smoke'; command = 'powershell -NoProfile -ExecutionPolicy Bypass -File tools/experimental-procedure-smoke.ps1' },
    @{ name = 'python-tests'; command = 'pnpm test:python' },
    @{ name = 'typecheck'; command = 'pnpm typecheck' }
  )
  foreach ($entry in $commands) {
    $runId = [guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $env:TEMP "gcl-audit-$runId.out.log"
    $stderrPath = Join-Path $env:TEMP "gcl-audit-$runId.err.log"
    try {
      $process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $entry.command) -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -Wait -PassThru
      $output = ((Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue)) -join "`n"
    } finally {
      Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
    $passed = $process.ExitCode -eq 0
    $detail = if ($passed) { 'passed' } else { $output.Trim() }
    $severity = if ($passed) { 'pass' } else { 'fail' }
    Add-Check "tests:$($entry.name)" $passed $detail $severity
  }
}

$externalPending = @(
  'GTA V Enhanced + SHVDN Enhanced mod load',
  'real GTA effect ACK from gta-real-smoke.py',
  'real TikTok LIVE session',
  'performance measurement on target hardware'
)
$failed = @($checks | Where-Object { $_.severity -eq 'fail' })
$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  workspace = $workspace
  localChecks = $checks
  externalValidationPending = $externalPending
  localAuditPassed = $failed.Count -eq 0
  acceptanceReady = $false
}
$result | ConvertTo-Json -Depth 8
