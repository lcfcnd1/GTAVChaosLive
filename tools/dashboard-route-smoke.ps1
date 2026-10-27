[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:5173'
)

$ErrorActionPreference = 'Stop'
function Get-Text([string]$Path) {
  $response = Invoke-WebRequest -Uri ($BaseUrl + $Path) -UseBasicParsing -TimeoutSec 5
  if ($response.StatusCode -ne 200) { throw "dashboard_route_status:${Path}:$($response.StatusCode)" }
  return $response.Content
}

$html = Get-Text '/'
if ($html -notmatch '<div id="root"></div>') { throw 'dashboard_root_missing' }
if ($html -notmatch 'src="/src/main\.tsx"') { throw 'dashboard_entry_missing' }
$module = Get-Text '/src/main.tsx'
if ($module -notmatch 'createRoot') { throw 'dashboard_module_not_served' }
Write-Output (ConvertTo-Json ([ordered]@{ root = '200'; entry = '200'; module = '200'; status = 'passed' }))
