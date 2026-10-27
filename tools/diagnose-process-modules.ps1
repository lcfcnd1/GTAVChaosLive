[CmdletBinding()]
param(
  [string]$ProcessName = 'GTA5_Enhanced',
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $workspace = Split-Path -Parent $PSScriptRoot
  $diagnostics = Join-Path $workspace 'data\diagnostics'
  New-Item -ItemType Directory -Force -Path $diagnostics | Out-Null
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  $OutputPath = Join-Path $diagnostics "gta-enhanced-module-diagnostic.$stamp.json"
} else {
  $parent = Split-Path -Parent $OutputPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
}

$startedAt = (Get-Date).ToUniversalTime()
$targetNames = @('dinput8.dll', 'ScriptHookV.dll', 'NativeTrainer.asi', 'ScriptHookVDotNet.asi', 'ScriptHookVDotNet2.dll', 'ScriptHookVDotNet3.dll', 'MinHook.x64.dll')
$result = [ordered]@{
  schemaVersion = 1
  startedAtUtc = $startedAt.ToString('o')
  completedAtUtc = $null
  processName = $ProcessName
  process = @()
  moduleEnumeration = [ordered]@{
    attempted = $false
    succeeded = $false
    blocked = $false
    error = $null
  }
  modules = @()
  targets = @()
  overallClassification = 'Inspección bloqueada o inconclusa'
  safety = [ordered]@{
    injected = $false
    memoryModified = $false
    launcherModified = $false
    antiCheatModified = $false
  }
}

$processes = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
if ($processes.Count -eq 0) {
  $result.completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  $result.moduleEnumeration.error = "No se encontró un proceso $ProcessName. Iniciá GTA V Enhanced y mantené Story Mode abierto."
  $result.targets = @($targetNames | ForEach-Object {
    [ordered]@{ name = $_; classification = 'Inspección bloqueada o inconclusa'; observed = $false; reason = 'Proceso no disponible' }
  })
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  $result | ConvertTo-Json -Depth 8
  exit 2
}

if ($processes.Count -gt 1) {
  $result.moduleEnumeration.error = "Se encontraron $($processes.Count) procesos $ProcessName; se inspeccionan todos."
}

$allModules = @()
foreach ($process in $processes) {
  $processRecord = [ordered]@{
    pid = $process.Id
    name = $process.ProcessName
    path = $null
    startTimeUtc = $null
  }
  try { $processRecord.path = $process.MainModule.FileName } catch { $processRecord.path = $null }
  try { $processRecord.startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o') } catch { $processRecord.startTimeUtc = $null }
  $result.process = @($result.process) + $processRecord

  try {
    $result.moduleEnumeration.attempted = $true
    $modules = @($process.Modules)
    $result.moduleEnumeration.succeeded = $true
    foreach ($module in $modules) {
      $fileVersion = $null
      $productVersion = $null
      try {
        $fileVersion = $module.FileVersionInfo.FileVersion
        $productVersion = $module.FileVersionInfo.ProductVersion
      } catch { }
      $record = [ordered]@{
        pid = $process.Id
        name = $module.ModuleName
        path = $module.FileName
        fileVersion = $fileVersion
        productVersion = $productVersion
        size = $module.ModuleMemorySize
      }
      $allModules += $record
    }
  } catch {
    $result.moduleEnumeration.blocked = $true
    $result.moduleEnumeration.error = $_.Exception.Message
  }
}

$result.modules = $allModules
foreach ($target in $targetNames) {
  $matches = @($allModules | Where-Object { $_.name -ieq $target })
  if ($matches.Count -eq 0) {
    $classification = if ($result.moduleEnumeration.succeeded) { 'DLL no observada' } else { 'Inspección bloqueada o inconclusa' }
    $reason = if ($result.moduleEnumeration.succeeded) { 'El módulo no aparece en Process.Modules.' } else { $result.moduleEnumeration.error }
    $result.targets += [ordered]@{ name = $target; observed = $false; classification = $classification; matches = @(); reason = $reason }
    continue
  }
  $targetMatches = foreach ($match in $matches) {
    $location = if ($match.path -match '(?i)\\System32\\') {
      'System32'
    } elseif ($match.path -match '(?i)Grand Theft Auto V Enhanced') {
      'carpeta del juego'
    } else {
      'otra ruta'
    }
    $classification = if ($match.path -ieq ($result.process | Where-Object pid -eq $match.pid | Select-Object -First 1).path -or $match.path -match '(?i)Grand Theft Auto V Enhanced') {
      'DLL cargada desde la carpeta del juego'
    } else {
      'DLL cargada desde otra ruta'
    }
    [ordered]@{ path = $match.path; location = $location; classification = $classification; fileVersion = $match.fileVersion; productVersion = $match.productVersion }
  }
  $result.targets += [ordered]@{ name = $target; observed = $true; classification = 'Observada; revisar ubicación'; matches = @($targetMatches); reason = 'El módulo aparece en Process.Modules.' }
}

$observed = @($result.targets | Where-Object observed)
$blocked = $result.moduleEnumeration.blocked
$result.overallClassification = if ($blocked) {
  'Inspección bloqueada o inconclusa'
} elseif ($observed.Count -eq 0) {
  'DLL no observada'
} elseif (@($observed | Where-Object { $_.matches.classification -contains 'DLL cargada desde la carpeta del juego' }).Count -gt 0) {
  'DLL cargada desde la carpeta del juego'
} else {
  'DLL cargada desde otra ruta'
}
$result.completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$result | ConvertTo-Json -Depth 10
Write-Output "Resultado guardado en: $OutputPath"
