$ErrorActionPreference = 'Stop'

$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\mods\gta-chaos-live\LocalCommandClient.cs') -Raw
$checks = [ordered]@{
  usesBaseDirectory = $source.Contains('string directory = baseDirectory')
  usesLinkedSessionCancellation = $source.Contains('CreateLinkedTokenSource(stop)')
  observesBothTasks = $source.Contains('ObserveTask(receive') -and $source.Contains('ObserveTask(send')
  disposesAfterTaskObservation = $source.Contains('await ObserveTask(send')
  queuesResultWithCommandId = $source.Contains('result.queued id=')
  distinguishesCommandAccepted = $source.Contains('command.accepted id=')
  singleWriter = ([regex]::Matches($source, 'socket\.SendAsync\(').Count -eq 1)
  textFrames = $source.Contains('WebSocketMessageType.Text')
  completeFrames = $source.Contains('WebSocketMessageType.Text, true, sessionStop')
  logsSendCompletionState = $source.Contains('socket.state.after_send session=')
  logsFrameHash = $source.Contains('result.frame.sha256 session=')
  noTokenLogging = -not $source.Contains('token=" + token')
}
foreach ($entry in $checks.GetEnumerator()) {
  if (-not $entry.Value) { throw "transport regression failed: $($entry.Key)" }
}
Write-Output (($checks | ConvertTo-Json -Compress))
