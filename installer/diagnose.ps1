[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$GtaPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

function Find-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Test-File([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  return Test-Path -LiteralPath $Path -PathType Leaf
}

function Get-FileVersion([string]$Path) {
  if (-not (Test-File $Path)) { return $null }
  try {
    $raw = (Get-Item -LiteralPath $Path).VersionInfo.FileVersion
    $null = [version]$raw
    return $raw
  } catch { return $null }
}

function Get-ShvdnVersion([string]$Path) {
  if (-not (Test-File $Path)) {
    return [ordered]@{ fileVersion = $null; enhancedCompatible = $false }
  }
  try {
    $fileVersion = (Get-Item -LiteralPath $Path).VersionInfo.FileVersion
    $version = [version]$fileVersion
    return [ordered]@{ fileVersion = $fileVersion; enhancedCompatible = ($version.Major -ge 4) }
  } catch {
    return [ordered]@{ fileVersion = $null; enhancedCompatible = $false }
  }
}

function Get-DotNetFramework48Status {
  $release = $null
  try { $release = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction Stop).Release } catch { }
  $present = $false
  if ($release -ne $null) { try { $present = [int]$release -ge 528040 } catch { $present = $false } }
  return [ordered]@{ present = $present; release = $release; minimumRelease = 528040 }
}

function Get-VisualCppRuntimeX64Status {
  $paths = @(
    'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
  )
  foreach ($path in $paths) {
    try {
      $runtime = Get-ItemProperty -LiteralPath $path -ErrorAction Stop
      if ([int]$runtime.Installed -eq 1) { return [ordered]@{ present = $true; version = [string]$runtime.Version; registryPath = $path } }
    } catch { }
  }
  return [ordered]@{ present = $false; version = $null; registryPath = $null }
}

function Find-FirstFile([string[]]$Roots, [string]$Name) {
  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    $patterns = if ($Name -eq 'link.exe') {
      @((Join-Path $root 'VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe'), (Join-Path $root 'VC\Tools\MSVC\*\bin\Hostx86\x64\link.exe'))
    } else {
      @(Join-Path $root "*\$Name")
    }
    $match = $patterns | ForEach-Object { Get-Item -Path $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
    if ($match) { return $match.FullName }
  }
  return $null
}

function Find-WindowsSdkX64Kernel32([string[]]$Roots) {
  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    $match = Get-Item -Path (Join-Path $root '*\um\x64\kernel32.lib') -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($match) { return $match }
  }
  return $null
}

function Test-LocalPort([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(300)) { return $false }
    return $client.Connected
  } catch { return $false }
  finally { $client.Dispose() }
}

function Get-HttpStatus([string]$Url) {
  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(2)
  try {
    $response = $client.GetAsync($Url).GetAwaiter().GetResult()
    return [int]$response.StatusCode
  } catch { return $null }
  finally { $client.Dispose() }
}

function Get-SteamLibraryRoots {
  $roots = [System.Collections.Generic.List[string]]::new()
  $steamRoots = [System.Collections.Generic.List[string]]::new()
  foreach ($registryPath in @('HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam', 'HKCU:\SOFTWARE\Valve\Steam')) {
    try {
      $item = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
      foreach ($property in @('SteamPath', 'InstallPath')) {
        if ($item.$property) { $steamRoots.Add(([string]$item.$property).Replace('/', '\')) }
      }
    } catch { }
  }
  $steamRoots.Add('C:\Program Files (x86)\Steam')
  $steamRoots.Add('C:\Program Files\Steam')
  foreach ($steamRoot in ($steamRoots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $steamRoot -PathType Container)) { continue }
    $roots.Add($steamRoot)
    $libraryFile = Join-Path $steamRoot 'steamapps\libraryfolders.vdf'
    if (Test-Path -LiteralPath $libraryFile -PathType Leaf) {
      $content = Get-Content -LiteralPath $libraryFile -Raw
      foreach ($match in [regex]::Matches($content, '(?m)^\s*"path"\s*"([^"]+)"')) {
        $roots.Add($match.Groups[1].Value.Replace('\\', '\'))
      }
    }
  }
  return @($roots | Where-Object { $_ } | Select-Object -Unique)
}

$candidateRoots = @()
if ($GtaPath) { $candidateRoots += $GtaPath }
$candidateRoots += @(
  'C:\Program Files\Rockstar Games\Grand Theft Auto V Enhanced',
  'C:\Program Files\Rockstar Games\Grand Theft Auto V',
  'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V',
  'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'
)
$steamLibraries = Get-SteamLibraryRoots
foreach ($library in $steamLibraries) {
  $candidateRoots += @(
    (Join-Path $library 'steamapps\common\Grand Theft Auto V Enhanced'),
    (Join-Path $library 'steamapps\common\Grand Theft Auto V')
  )
}
$candidateRoots = $candidateRoots | Where-Object { $_ } | Select-Object -Unique
$candidateRoots = $candidateRoots | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
$detectedEnhancedRoot = $candidateRoots | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'GTA5_Enhanced.exe') -PathType Leaf } | Select-Object -First 1
$detectedLegacyRoot = $candidateRoots | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'GTA5.exe') -PathType Leaf } | Select-Object -First 1
$detectedRoot = if ($detectedEnhancedRoot) { $detectedEnhancedRoot } else { $detectedLegacyRoot }

$gtaEnhanced = if ($detectedRoot) { Join-Path $detectedRoot 'GTA5_Enhanced.exe' } else { $null }
$gtaLegacy = if ($detectedRoot) { Join-Path $detectedRoot 'GTA5.exe' } else { $null }
$scriptHook = if ($detectedRoot) { Join-Path $detectedRoot 'ScriptHookV.dll' } else { $null }
$shvdn = if ($detectedRoot) { Join-Path $detectedRoot 'ScriptHookVDotNet3.dll' } else { $null }
$shvdnVersion = Get-ShvdnVersion $shvdn
$gtaEnhancedVersion = Get-FileVersion $gtaEnhanced
$gtaLegacyVersion = Get-FileVersion $gtaLegacy
$scriptHookVersion = Get-FileVersion $scriptHook
$knownEnhancedPatches = @('1.0.1158.13')
$enhancedPatchCompatible = [bool]($gtaEnhancedVersion -and ($knownEnhancedPatches -contains $gtaEnhancedVersion))
$dotNet48 = Get-DotNetFramework48Status
$visualCppX64 = Get-VisualCppRuntimeX64Status

$webView = Get-ChildItem 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
$msvcLinker = Find-FirstFile @('C:\Program Files\Microsoft Visual Studio', 'C:\Program Files (x86)\Microsoft Visual Studio') 'link.exe'
$windowsSdkLib = Find-WindowsSdkX64Kernel32 @('C:\Program Files (x86)\Windows Kits\10\Lib', 'C:\Program Files\Windows Kits\10\Lib')
$reportedLinker = Find-CommandPath 'link.exe'
if (-not $reportedLinker) { $reportedLinker = $msvcLinker }
$orchestratorPort = Test-LocalPort 39177
$overlayPort = Test-LocalPort 39178
$overlayStatus = Get-HttpStatus 'http://127.0.0.1:39178/overlay/vertical'
$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  gta = [ordered]@{
    root = $detectedRoot
    steamLibraries = @($steamLibraries)
    detection = if ($detectedEnhancedRoot) { 'steam_or_explicit_enhanced' } elseif ($detectedLegacyRoot) { 'steam_or_explicit_legacy' } else { 'not_found' }
    enhancedExecutable = [ordered]@{ path = $gtaEnhanced; present = (Test-File $gtaEnhanced); fileVersion = $gtaEnhancedVersion; versionDetected = [bool]$gtaEnhancedVersion }
    compatibility = [ordered]@{ knownOfficialEnhancedPatches = $knownEnhancedPatches; detectedPatch = $gtaEnhancedVersion; patchKnownCompatible = $enhancedPatchCompatible; status = if (-not $gtaEnhancedVersion) { 'not_detected' } elseif ($enhancedPatchCompatible) { 'known_compatible_patch' } else { 'unsupported_or_unverified_patch' } }
    legacyExecutable = [ordered]@{ path = $gtaLegacy; present = (Test-File $gtaLegacy); fileVersion = $gtaLegacyVersion; versionDetected = [bool]$gtaLegacyVersion }
    storyModeOnly = $true
  }
  modDependencies = [ordered]@{
    scriptHookV = [ordered]@{ path = $scriptHook; present = (Test-File $scriptHook); fileVersion = $scriptHookVersion; versionDetected = [bool]$scriptHookVersion }
    scriptHookVDotNetEnhanced = [ordered]@{ path = $shvdn; present = (Test-File $shvdn); fileVersion = $shvdnVersion.fileVersion; enhancedCompatible = $shvdnVersion.enhancedCompatible }
  }
  runtime = [ordered]@{
    node = Find-CommandPath 'node'
    python = Find-CommandPath 'python'
    cargo = Find-CommandPath 'cargo'
    msvcLinker = $reportedLinker
    windowsSdkKernel32 = [ordered]@{ path = $windowsSdkLib; present = (Test-File $windowsSdkLib) }
    webView2Detected = [bool]$webView
    dotNetFramework48 = $dotNet48
    visualCppRuntimeX64 = $visualCppX64
  }
  localServices = [ordered]@{
    orchestratorPort = [ordered]@{ port = 39177; listening = $orchestratorPort }
    overlayPort = [ordered]@{ port = 39178; listening = $overlayPort; verticalHttpStatus = $overlayStatus }
    communicationHealthy = [bool]($orchestratorPort -and $overlayPort -and $overlayStatus -eq 200)
  }
  safeToInstall = $false
  notes = @(
    'This diagnostic is read-only.',
    'No third-party binary is downloaded or copied.',
    'Do not use mods with GTA Online.',
    'Official GTA V Enhanced / Script Hook V information: https://www.dev-c.com/post/scripthookv-enhanced',
    'Official ScriptHookVDotNet Enhanced releases: https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/releases',
    'Official WebView2 runtime: https://developer.microsoft.com/microsoft-edge/webview2/',
    'Official .NET Framework 4.8 download: https://dotnet.microsoft.com/download/dotnet-framework/net48',
    'Official Visual C++ Redistributable x64: https://aka.ms/vs/17/release/vc_redist.x64.exe'
  )
}
$result.safeToInstall = [bool]($result.gta.enhancedExecutable.present -and $result.gta.enhancedExecutable.versionDetected -and $result.gta.compatibility.patchKnownCompatible -and $result.modDependencies.scriptHookV.present -and $result.modDependencies.scriptHookV.versionDetected -and $result.modDependencies.scriptHookVDotNetEnhanced.enhancedCompatible -and $result.runtime.dotNetFramework48.present -and $result.runtime.visualCppRuntimeX64.present)
$result | ConvertTo-Json -Depth 6
