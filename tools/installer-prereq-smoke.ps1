[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$diagnosticPath = Join-Path $workspace 'installer/diagnose.ps1'
$diagnostic = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $diagnosticPath | ConvertFrom-Json

foreach ($property in @('dotNetFramework48', 'visualCppRuntimeX64')) {
  if ($null -eq $diagnostic.runtime.$property -or $diagnostic.runtime.$property.present -isnot [bool]) {
    throw "El diagnóstico no expone runtime.$property.present como booleano."
  }
}
$requiredLinks = @(
  'https://dotnet.microsoft.com/download/dotnet-framework/net48',
  'https://aka.ms/vs/17/release/vc_redist.x64.exe'
)
foreach ($link in $requiredLinks) {
  if (-not @($diagnostic.notes) -contains "Official .NET Framework 4.8 download: $link" -and -not @($diagnostic.notes) -contains "Official Visual C++ Redistributable x64: $link") {
    throw "Falta el enlace oficial requerido en el diagnóstico: $link"
  }
}
$gamePrerequisites = [bool]($diagnostic.gta.enhancedExecutable.present -and $diagnostic.gta.enhancedExecutable.versionDetected -and $diagnostic.gta.compatibility.patchKnownCompatible -and $diagnostic.modDependencies.scriptHookV.present -and $diagnostic.modDependencies.scriptHookV.versionDetected -and $diagnostic.modDependencies.scriptHookVDotNetEnhanced.enhancedCompatible -and $diagnostic.runtime.dotNetFramework48.present -and $diagnostic.runtime.visualCppRuntimeX64.present)
if ([bool]$diagnostic.safeToInstall -ne $gamePrerequisites) { throw 'safeToInstall no coincide con los prerrequisitos reportados.' }

foreach ($path in @(
  (Join-Path $workspace 'apps/overlay/overlay.js'),
  (Join-Path $workspace 'services/tiktok-connector/connector.py'),
  (Join-Path $workspace 'mods/gta-chaos-live/LocalCommandClient.cs'),
  (Join-Path $workspace 'services/orchestrator/src/index.ts'),
  (Join-Path $workspace 'apps/dashboard/src/main.tsx')
)) {
  if ((Get-Content -LiteralPath $path -Raw) -match 'dev-only-change-me') {
    throw "Se encontró un fallback de autenticación predecible en $path."
  }
}

$probe = Join-Path ([IO.Path]::GetTempPath()) ("gcl-installer-prereq-" + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $probe | Out-Null
  $stdout = Join-Path $probe 'install.out.log'
  $stderr = Join-Path $probe 'install.err.log'
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $workspace 'installer/install-mod.ps1'), '-GtaPath', $probe, '-Consent', 'I UNDERSTAND STORY MODE ONLY', '-ChaosToken', 'installer-smoke-token-20261024') -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru
  if ($process.ExitCode -eq 0) { throw 'install-mod.ps1 aceptó una carpeta sin GTA Enhanced.' }
  if (Test-Path -LiteralPath (Join-Path $probe 'scripts')) { throw 'install-mod.ps1 creó archivos durante la prueba negativa.' }

  $connector = Join-Path $workspace 'apps/desktop/src-tauri/runtime/tiktok-connector.exe'
  if (Test-Path -LiteralPath $connector -PathType Leaf) {
    $connectorOut = Join-Path $probe 'connector.out.log'
    $connectorErr = Join-Path $probe 'connector.err.log'
    $connectorProcess = Start-Process -FilePath $connector -ArgumentList 'security-smoke-user' -WindowStyle Hidden -RedirectStandardOutput $connectorOut -RedirectStandardError $connectorErr -Wait -PassThru
    $connectorText = ((Get-Content -LiteralPath $connectorOut -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $connectorErr -ErrorAction SilentlyContinue)) -join "`n"
    if ($connectorProcess.ExitCode -eq 0 -or $connectorText -notmatch 'provide --token or set CHAOS_TOKEN') {
      throw 'El conector empaquetado no rechazó una ejecución sin token.'
    }
  }
} finally {
  if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Recurse -Force }
}

[pscustomobject]@{
  diagnosticSchema = 'ok'
  dependencyLinks = 'ok'
  tokenFailClosed = 'ok'
  safeToInstall = [bool]$diagnostic.safeToInstall
  negativeInstall = 'rejected_without_writes'
} | ConvertTo-Json -Compress
