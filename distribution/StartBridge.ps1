$ErrorActionPreference = "Stop"
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "update-config.json") -Raw | ConvertFrom-Json
$bridge = Get-Content -LiteralPath (Join-Path $PSScriptRoot "bridge-config.json") -Raw | ConvertFrom-Json
try {
  $health = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $bridge.port + "/health") -Headers @{ Authorization = "Bearer " + $bridge.token } -TimeoutSec 2
  if ($health.ready) { exit }
} catch {}
$nodePath = $config.nodePath
if (!$nodePath -or !(Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node.exe -ErrorAction Stop).Source }
& $nodePath (Join-Path $PSScriptRoot "Bridge.cjs")
