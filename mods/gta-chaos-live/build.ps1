[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [string]$OutputPath,
  [switch]$AllowLegacy
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $PSScriptRoot 'bin\GtaChaosLive.dll' }
$compilerCandidates = @(
  'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
  'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'No se encontró csc.exe de .NET Framework.' }
$shvdn = Join-Path $GtaPath 'ScriptHookVDotNet3.dll'
if (-not (Test-Path -LiteralPath $shvdn)) { throw "No se encontró ScriptHookVDotNet3.dll en $GtaPath" }
$enhanced = Test-Path -LiteralPath (Join-Path $GtaPath 'GTA5_Enhanced.exe') -PathType Leaf
$legacy = Test-Path -LiteralPath (Join-Path $GtaPath 'GTA5.exe') -PathType Leaf
if (-not $enhanced -and -not $AllowLegacy) {
  throw 'La compilación requiere una instalación GTA V Enhanced con GTA5_Enhanced.exe. Use -AllowLegacy únicamente para una compilación Legacy explícita.'
}
$shvdnVersionRaw = (Get-Item -LiteralPath $shvdn).VersionInfo.FileVersion
try { $shvdnVersion = [version]$shvdnVersionRaw } catch { throw "No se pudo leer la versión de ScriptHookVDotNet3.dll: $shvdnVersionRaw" }
if ($enhanced -and $shvdnVersion.Major -lt 4) { throw "La DLL $shvdnVersionRaw es Legacy; se requiere ScriptHookVDotNet Enhanced (major de FileVersion >= 4)." }
$scriptHook = Join-Path $GtaPath 'ScriptHookV.dll'
if (-not (Test-Path -LiteralPath $scriptHook)) { throw 'No se encontró ScriptHookV.dll en la instalación seleccionada.' }
$scriptHookVersion = (Get-Item -LiteralPath $scriptHook).VersionInfo.FileVersion
$targetExe = if ($enhanced) { Join-Path $GtaPath 'GTA5_Enhanced.exe' } elseif ($legacy) { Join-Path $GtaPath 'GTA5.exe' } else { $null }
if ($enhanced) {
  $enhancedVersion = (Get-Item -LiteralPath $targetExe).VersionInfo.FileVersion
  if ($enhancedVersion -ne '1.0.1158.13') { throw "No hay compatibilidad oficial registrada para GTA V Enhanced $enhancedVersion; el build soportado actualmente es 1.0.1158.13." }
}
Write-Output "Target: $(if ($enhanced) { 'GTA V Enhanced' } else { 'GTA V Legacy (explicit)' })"
Write-Output "GTA5 version: $(if ($targetExe) { (Get-Item -LiteralPath $targetExe).VersionInfo.FileVersion } else { 'not detected; explicit dependency-only Legacy build' })"
Write-Output "ScriptHookV version: $scriptHookVersion"
Write-Output "ScriptHookVDotNet version: $shvdnVersionRaw"
$outputDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
& $compiler /nologo /target:library /out:$OutputPath /reference:$shvdn /reference:System.dll /reference:System.Core.dll /reference:System.Runtime.Serialization.dll /reference:System.Net.Http.dll "$PSScriptRoot\ChaosScript.cs" "$PSScriptRoot\EffectParameterParser.cs" "$PSScriptRoot\LocalCommandClient.cs"
if ($LASTEXITCODE -ne 0) { throw "La compilación falló con código $LASTEXITCODE" }
Write-Output "Compilado: $OutputPath"
$targetLabel = if ($enhanced) { 'Enhanced' } else { 'Legacy' }
$metadataPath = [IO.Path]::ChangeExtension($OutputPath, '.build.json')
$metadata = [ordered]@{
  target = $targetLabel
  gtaPath = (Resolve-Path -LiteralPath $GtaPath).Path
  gtaExecutable = if ($targetExe) { (Split-Path -Leaf $targetExe) } else { $null }
  gtaVersion = if ($targetExe) { (Get-Item -LiteralPath $targetExe).VersionInfo.FileVersion } else { $null }
  scriptHookVVersion = $scriptHookVersion
  scriptHookVDotNetVersion = $shvdnVersionRaw
  dllSha256 = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataPath -Encoding UTF8
Write-Output "Metadata: $metadataPath"
