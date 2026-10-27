[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)] [string]$GtaPath,
  [Parameter(Mandatory = $true)] [ValidateSet('I UNDERSTAND STORY MODE ONLY')] [string]$Consent,
  [Parameter(Mandatory = $true)] [string]$ChaosToken,
  [switch]$AllowOverwrite
)

$ErrorActionPreference = 'Stop'
$ConfirmPreference = 'None'
$dotNetRelease = $null
try { $dotNetRelease = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction Stop).Release } catch { }
if ($dotNetRelease -eq $null -or [int]$dotNetRelease -lt 528040) { throw 'No se detectó .NET Framework 4.8 o superior; instalación detenida.' }
$vcRuntime = $null
foreach ($registryPath in @('HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')) {
  try { $candidate = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop; if ([int]$candidate.Installed -eq 1) { $vcRuntime = $candidate; break } } catch { }
}
if (-not $vcRuntime) { throw 'No se detectó Visual C++ Redistributable x64; instalación detenida.' }
$enhancedExe = Join-Path $GtaPath 'GTA5_Enhanced.exe'
$scriptHookV = Join-Path $GtaPath 'ScriptHookV.dll'
$shvdn = Join-Path $GtaPath 'ScriptHookVDotNet3.dll'
if (-not (Test-Path -LiteralPath $GtaPath -PathType Container)) { throw "La ruta no existe: $GtaPath" }
if (@(Get-Process -Name 'GTA5_Enhanced', 'GTA5' -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GTA V está ejecutándose. Cierre GTA V antes de instalar para evitar modificar archivos en uso.' }
if (-not (Test-Path -LiteralPath $enhancedExe -PathType Leaf)) { throw 'No se encontró GTA5_Enhanced.exe; instalación detenida.' }
$gameVersionRaw = (Get-Item -LiteralPath $enhancedExe).VersionInfo.FileVersion
try { $null = [version]$gameVersionRaw } catch { throw "No se pudo verificar la versión de GTA5_Enhanced.exe; instalación detenida." }
if ([string]::IsNullOrWhiteSpace($gameVersionRaw)) { throw 'GTA5_Enhanced.exe no contiene una versión verificable; instalación detenida.' }
if ($gameVersionRaw -ne '1.0.1158.13') { throw "No hay compatibilidad oficial registrada para GTA V Enhanced $gameVersionRaw; instalación detenida." }
if ($ChaosToken.Length -lt 16 -or $ChaosToken.Length -gt 128 -or $ChaosToken -notmatch '^[A-Za-z0-9-]+$') { throw 'El token local no tiene un formato seguro; instalación detenida.' }
if (-not (Test-Path -LiteralPath $scriptHookV -PathType Leaf)) { throw 'No se encontró ScriptHookV.dll; instalación detenida.' }
$scriptHookVersionRaw = (Get-Item -LiteralPath $scriptHookV).VersionInfo.FileVersion
try { $null = [version]$scriptHookVersionRaw } catch { throw 'No se pudo verificar la versión de ScriptHookV.dll; instalación detenida.' }
if ([string]::IsNullOrWhiteSpace($scriptHookVersionRaw)) { throw 'ScriptHookV.dll no contiene una versión verificable; instalación detenida.' }
if (-not (Test-Path -LiteralPath $shvdn -PathType Leaf)) { throw 'No se encontró ScriptHookVDotNet3.dll; instalación detenida.' }
$shvdnVersion = [version](Get-Item -LiteralPath $shvdn).VersionInfo.FileVersion
if ($shvdnVersion.Major -lt 4) { throw "ScriptHookVDotNet3.dll $shvdnVersion parece Legacy; se requiere una versión SHVDN Enhanced con major de FileVersion >= 4." }

$source = Join-Path $PSScriptRoot '..\mods\gta-chaos-live\bin\GtaChaosLive.dll'
$metadataPath = [IO.Path]::ChangeExtension($source, '.build.json')
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Primero compile el mod con mods\gta-chaos-live\build.ps1.' }
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw 'Falta la metadata de compilación del mod; no se instala un DLL sin target verificable.' }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ([string]$metadata.target -ne 'Enhanced') { throw "El DLL disponible fue compilado para $($metadata.target), no para GTA V Enhanced. Recompile contra SHVDN Enhanced real antes de instalar." }
if ([string]$metadata.scriptHookVDotNetVersion -ne $shvdnVersionRaw) { throw "El DLL fue compilado contra SHVDN $($metadata.scriptHookVDotNetVersion), pero la instalación usa $shvdnVersionRaw." }
if ([string]$metadata.gtaVersion -ne $gameVersionRaw) { throw "El DLL fue compilado para GTA $($metadata.gtaVersion), pero la instalación usa GTA $gameVersionRaw." }
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne [string]$metadata.dllSha256) { throw 'La metadata no coincide con el DLL; recompile el mod antes de instalar.' }
$scripts = Join-Path $GtaPath 'scripts'
$destination = Join-Path $scripts 'GtaChaosLive.dll'
$tokenDestination = Join-Path $scripts 'gta-chaos-live.token'
if ((Test-Path -LiteralPath $destination -PathType Leaf) -and -not $AllowOverwrite) { throw "Ya existe $destination. Use -AllowOverwrite para solicitar backup y reemplazo." }
if ((Test-Path -LiteralPath $tokenDestination -PathType Leaf) -and -not $AllowOverwrite) {
  $existingToken = (Get-Content -LiteralPath $tokenDestination -Raw).Trim()
  if ($existingToken -ne $ChaosToken) { throw "Ya existe $tokenDestination con otro token. Use -AllowOverwrite para solicitar backup y reemplazo." }
}

if ($PSCmdlet.ShouldProcess($destination, 'Instalar únicamente GtaChaosLive.dll')) {
  New-Item -ItemType Directory -Force -Path $scripts | Out-Null
  $backupRoot = Join-Path $scripts ('GtaChaosLive.backup.' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
  $backedUp = $false
  if (Test-Path -LiteralPath $destination -PathType Leaf) {
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Copy-Item -LiteralPath $destination -Destination (Join-Path $backupRoot 'GtaChaosLive.dll') -ErrorAction Stop
    $backedUp = $true
  }
  if (Test-Path -LiteralPath $tokenDestination -PathType Leaf) {
    if (-not $backedUp) { New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null }
    Copy-Item -LiteralPath $tokenDestination -Destination (Join-Path $backupRoot 'gta-chaos-live.token') -ErrorAction Stop
    $backedUp = $true
  }
  Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
  Set-Content -LiteralPath $tokenDestination -Value $ChaosToken -NoNewline -Encoding ASCII
  if ($backedUp) { Write-Output "Backup creado: $backupRoot" }
  Write-Output "Instalado: $destination"
  Write-Output "Token local instalado: $tokenDestination"
  Write-Output 'Seguridad: este mod se instala únicamente para Story Mode; Script Hook V no funciona en GTA Online.'
}
