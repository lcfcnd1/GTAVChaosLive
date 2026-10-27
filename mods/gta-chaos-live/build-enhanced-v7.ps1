[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$compilerCandidates = @(
  'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
  'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'No se encontró csc.exe de .NET Framework.' }
$targetExe = Join-Path $GtaPath 'GTA5_Enhanced.exe'
$shvdn = Join-Path $GtaPath 'ScriptHookVDotNet3.dll'
if (-not (Test-Path -LiteralPath $targetExe -PathType Leaf)) { throw 'No se encontró GTA5_Enhanced.exe.' }
if (-not (Test-Path -LiteralPath $shvdn -PathType Leaf)) { throw 'No se encontró ScriptHookVDotNet3.dll.' }
$gtaVersion = (Get-Item -LiteralPath $targetExe).VersionInfo.FileVersion
if ($gtaVersion -ne '1.0.1158.16') { throw "Versión Enhanced inesperada: $gtaVersion" }
$shvdnVersion = (Get-Item -LiteralPath $shvdn).VersionInfo.FileVersion
$outputDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
& $compiler /nologo /target:library /out:$OutputPath /reference:$shvdn /reference:System.dll /reference:System.Core.dll /reference:System.Runtime.Serialization.dll /reference:System.Net.Http.dll /reference:System.Windows.Forms.dll "$PSScriptRoot\ChaosScript.cs" "$PSScriptRoot\EffectParameterParser.cs" "$PSScriptRoot\LocalCommandClient.cs"
if ($LASTEXITCODE -ne 0) { throw "La compilación v7 falló con código $LASTEXITCODE" }
$hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash
$metadataPath = [IO.Path]::ChangeExtension($OutputPath, '.build.json')
$metadata = [ordered]@{
  schemaVersion = 2
  build = 'v7'
  target = 'Enhanced'
  gtaExecutable = 'GTA5_Enhanced.exe'
  gtaVersion = $gtaVersion
  scriptHookV = '3889.0.1158.13'
  scriptHookVDotNetPackageVersion = '1.1.0.6'
  scriptHookVDotNetAssemblyVersion = $shvdnVersion
  api = '3.9.0'
  sourceInstrumented = $true
  transportDiagnostic = 'v6-compatible; no new protocol; ACK JSON serialization fix'
  resultSerializer = 'System.Runtime.Serialization.Json.DataContractJsonSerializer'
  installedToGame = $false
  sha256 = $hash
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataPath -Encoding UTF8
Write-Output "Compiled: $OutputPath"
Write-Output "SHA256: $hash"
Write-Output "Metadata: $metadataPath"
