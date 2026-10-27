[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$compiler = @(
  'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
  'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'No se encontró csc.exe de .NET Framework.' }
$probe = Join-Path ([IO.Path]::GetTempPath()) ('gcl-parameter-smoke-' + [guid]::NewGuid().ToString('N'))
$exe = Join-Path $probe 'parameter-smoke.exe'
try {
  New-Item -ItemType Directory -Path $probe | Out-Null
  & $compiler /nologo /target:exe /out:$exe /reference:System.dll /reference:System.Core.dll /reference:System.Runtime.Serialization.dll `
    (Join-Path $workspace 'mods/gta-chaos-live/EffectParameterParser.cs') `
    (Join-Path $workspace 'tools/LocalCommandClientParameterSmoke.cs')
  if ($LASTEXITCODE -ne 0) { throw "Compilación del smoke test falló: $LASTEXITCODE" }
  & $exe
  if ($LASTEXITCODE -ne 0) { throw "El smoke test falló: $LASTEXITCODE" }
} finally {
  if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Recurse -Force }
}
