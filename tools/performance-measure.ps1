[CmdletBinding()]
param(
  [ValidateRange(1, 3600)][int]$DurationSeconds = 30,
  [ValidateRange(250, 10000)][int]$IntervalMs = 1000,
  [string[]]$ProcessName = @('GTA5', 'gta-chaos-live', 'node', 'tiktok-connector'),
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$startedAt = [DateTime]::UtcNow
$previous = @{}
$samples = [System.Collections.Generic.List[object]]::new()
$processorCount = [Environment]::ProcessorCount
$deadline = $startedAt.AddSeconds($DurationSeconds)

while ([DateTime]::UtcNow -lt $deadline) {
  $now = [DateTime]::UtcNow
  $current = @{}
  $cpuDelta = 0.0
  $workingSetBytes = 0L
  $processCount = 0
  foreach ($name in ($ProcessName | Select-Object -Unique)) {
    foreach ($process in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
      $key = "$($process.ProcessName):$($process.Id)"
      $cpuSeconds = $process.TotalProcessorTime.TotalSeconds
      $current[$key] = $cpuSeconds
      if ($previous.ContainsKey($key)) { $cpuDelta += [Math]::Max(0.0, $cpuSeconds - [double]$previous[$key]) }
      $workingSetBytes += [int64]$process.WorkingSet64
      $processCount++
    }
  }
  $elapsed = [Math]::Max(0.001, ($now - $startedAt).TotalSeconds)
  $samples.Add([pscustomobject]@{
      timestamp = $now.ToString('o')
      processCount = $processCount
      workingSetMb = [Math]::Round($workingSetBytes / 1MB, 2)
      cpuPercentAllCores = [Math]::Round(($cpuDelta / [Math]::Max(0.001, $IntervalMs / 1000.0)) / $processorCount * 100, 2)
  })
  $previous = $current
  Start-Sleep -Milliseconds $IntervalMs
}

$result = [ordered]@{
  generatedAt = [DateTime]::UtcNow.ToString('o')
  durationSeconds = $DurationSeconds
  intervalMs = $IntervalMs
  processorCount = $processorCount
  processNames = @($ProcessName | Select-Object -Unique)
  sampleCount = $samples.Count
  maxWorkingSetMb = if ($samples.Count) { [Math]::Round(($samples | Measure-Object workingSetMb -Maximum).Maximum, 2) } else { 0 }
  averageCpuPercentAllCores = if ($samples.Count) { [Math]::Round(($samples | Measure-Object cpuPercentAllCores -Average).Average, 2) } else { 0 }
  maxCpuPercentAllCores = if ($samples.Count) { [Math]::Round(($samples | Measure-Object cpuPercentAllCores -Maximum).Maximum, 2) } else { 0 }
  samples = $samples
  note = 'Resource measurement only; no FPS claim is inferred from this output.'
}
$json = $result | ConvertTo-Json -Depth 6
if ($OutputPath) { Set-Content -LiteralPath $OutputPath -Value $json -Encoding UTF8 }
$json
