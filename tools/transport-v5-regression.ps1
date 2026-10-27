$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\mods\gta-chaos-live\LocalCommandClient.cs') -Raw
$checks = [ordered]@{
  linkedSessionCancellation = $source.Contains('CreateLinkedTokenSource(stop)')
  siblingCancellation = $source.Contains('sessionStop.Cancel()')
  siblingObservation = $source.Contains('ObserveTask(receive') -and $source.Contains('ObserveTask(send')
  disposeAfterObservation = $source.Contains('await ObserveTask(send')
  singleWriterLoop = ([regex]::Matches($source, 'socket\.SendAsync\(').Count -eq 1)
  textFrames = $source.Contains('WebSocketMessageType.Text')
  completeFrames = $source.Contains('WebSocketMessageType.Text, true, sessionStop')
  sessionCorrelation = $source.Contains('socket.session.created session=')
  frameHash = $source.Contains('result.frame.sha256 session=')
  commandIdPreserved = $source.Contains('result.queued id=')
  noTokenLogging = -not $source.Contains('token=" + token')
}
foreach ($entry in $checks.GetEnumerator()) {
  if (-not $entry.Value) { throw "transport v5 regression failed: $($entry.Key)" }
}
Write-Output ($checks | ConvertTo-Json -Compress)
