param([string]$Repository = "", [string]$DevelopmentExtensionId = "", [switch]$Quiet)
$ErrorActionPreference = "Stop"
$target = Join-Path $env:LOCALAPPDATA "MakerWorkflow"
$source = [IO.Path]::GetFullPath($PSScriptRoot)
if ([IO.Path]::GetFullPath($target) -ne $source) {
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $source -Force) {
    if ($item.Name -notin @("stage", "backup", "update.log", "pending.json")) {
      if ($item.Name -eq "NativeHost.exe" -and (Test-Path -LiteralPath (Join-Path $target $item.Name)) -and
          (Get-FileHash -LiteralPath $item.FullName).Hash -eq (Get-FileHash -LiteralPath (Join-Path $target $item.Name)).Hash) { continue }
      Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force
    }
  }
}
$configPath = Join-Path $target "update-config.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($Repository) { $config.repository = $Repository }
if (!$config.repository) { $config.repository = Read-Host "GitHub repository (OWNER/REPOSITORY)" }
if ($config.repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "Invalid GitHub repository." }
$config | Add-Member -NotePropertyName installId -NotePropertyValue ([Guid]::NewGuid().ToString()) -Force
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) { $config | Add-Member -NotePropertyName nodePath -NotePropertyValue $nodeCommand.Source -Force }
else {
  $sessionFile = Join-Path $env:USERPROFILE ".taptap-maker/console/session.json"
  if (Test-Path -LiteralPath $sessionFile) {
    $session = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json
    $makerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($session.pid)" -ErrorAction SilentlyContinue
    if ($makerProcess.ExecutablePath -match 'node\.exe$') {
      $config | Add-Member -NotePropertyName nodePath -NotePropertyValue $makerProcess.ExecutablePath -Force
    }
  }
}
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))
$marker = @{ installId = $config.installId; extensionId = $config.extensionId } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $target "extension/installation.json"), $marker, (New-Object Text.UTF8Encoding $false))
$bridgePath = Join-Path $target "bridge-config.json"
if (Test-Path -LiteralPath $bridgePath) { $bridge = Get-Content -LiteralPath $bridgePath -Raw | ConvertFrom-Json }
else { $bridge = @{ port = 49387; token = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N") } }
[IO.File]::WriteAllText($bridgePath, ($bridge | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
$client = @{ endpoint = "http://127.0.0.1:$($bridge.port)"; token = $bridge.token } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $target "extension/bridge.json"), $client, (New-Object Text.UTF8Encoding $false))
$bridgeScript = Join-Path $target "StartBridge.ps1"
$bridgeCommand = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $bridgeScript + '"'
New-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Force | Out-Null
New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "MakerWorkflowBridge" -Value $bridgeCommand -PropertyType String -Force | Out-Null
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ('"' + $bridgeScript + '"'))
$hostPath = Join-Path $target "native-host.json"
$origins = @("chrome-extension://$($config.extensionId)/")
if ($DevelopmentExtensionId -match '^[a-p]{32}$') { $origins += "chrome-extension://$DevelopmentExtensionId/" }
$hostManifest = @{
  name = "cn.maker.workflow.updater"
  description = "Maker Workflow signed internal updater"
  path = Join-Path $target "NativeHost.exe"
  type = "stdio"
  allowed_origins = $origins
} | ConvertTo-Json
[IO.File]::WriteAllText($hostPath, $hostManifest, (New-Object Text.UTF8Encoding $false))
foreach ($key in @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\cn.maker.workflow.updater",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\cn.maker.workflow.updater",
  "HKCU:\Software\Chromium\NativeMessagingHosts\cn.maker.workflow.updater"
)) {
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $hostPath
}
$extension = Join-Path $target "extension"
Write-Host ""
Write-Host "Installed. First installation only:"
Write-Host "1. Open edge://extensions or chrome://extensions"
Write-Host "2. Enable Developer mode"
Write-Host "3. Load unpacked -> $extension"
Write-Host "4. Open Maker canvas. Later updates run automatically."
Write-Host "Existing users: export/back up your old workflow data before switching extension IDs."
if (!$Quiet) { Start-Process explorer.exe -ArgumentList ('"{0}"' -f $extension) }
