$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$inputStream = [Console]::OpenStandardInput()
$outputStream = [Console]::OpenStandardOutput()
function Read-Bytes([int]$count) {
  $buffer = New-Object byte[] $count
  $offset = 0
  while ($offset -lt $count) {
    $read = $inputStream.Read($buffer, $offset, $count - $offset)
    if (!$read) { throw "Native message ended early." }
    $offset += $read
  }
  return ,$buffer
}
function Download([string]$url, [string]$destination) {
  $parsed = [Uri]$url
  if ($parsed.Scheme -ne "https" -or $parsed.Host -notin @("github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")) {
    throw "Untrusted update location."
  }
  $options = @{ UseBasicParsing = $true; Uri = $url; OutFile = $destination; TimeoutSec = 45; Headers = @{ "User-Agent" = "MakerWorkflow-Updater" } }
  foreach ($candidate in @($env:HTTPS_PROXY, $env:HTTP_PROXY, $config.proxy)) {
    if ($candidate -and $candidate -match '^https?://') { $options.Proxy = $candidate; break }
  }
  Invoke-WebRequest @options
}
function Verify-Metadata([string]$directory, $config) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $directory "update.json"))
  $signature = [Convert]::FromBase64String([IO.File]::ReadAllText((Join-Path $directory "update.sig")).Trim())
  $rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
  try {
    $rsa.FromXmlString($config.publicKeyXml)
    if (!$rsa.VerifyData($bytes, "SHA256", $signature)) { throw "Update signature rejected." }
  } finally { $rsa.Dispose() }
  return [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
}
function Run-Update($request) {
  $config = Get-Content -LiteralPath (Join-Path $root "update-config.json") -Raw | ConvertFrom-Json
  $installedManifest = Get-Content -LiteralPath (Join-Path $root "extension/manifest.json") -Raw | ConvertFrom-Json
  if ($request.action -eq "status") {
    return @{ status = "ok"; installedVersion = $installedManifest.version; extensionId = $config.extensionId;
      installId = $config.installId; directory = (Join-Path $root "extension"); repository = $config.repository }
  }
  if ($request.action -eq "bootstrap") {
    if ($request.extensionId -ne $config.extensionId) { throw "Loaded extension ID does not match the installed release." }
    if (!$config.installId) {
      $config | Add-Member -NotePropertyName installId -NotePropertyValue ([Guid]::NewGuid().ToString()) -Force
      [IO.File]::WriteAllText((Join-Path $root "update-config.json"), ($config | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding $false))
    }
    $marker = @{ installId = $config.installId; extensionId = $config.extensionId } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $root "extension/installation.json"), $marker, (New-Object Text.UTF8Encoding $false))
    return @{ status = "bootstrapped"; installId = $config.installId }
  }
  if ($request.action -eq "workflow") {
    $workflowHost = Join-Path $root "WorkflowHost.cjs"
    if (!(Test-Path -LiteralPath $workflowHost)) {
      $stageDirectory = Join-Path $root "stage"
      $metadata = Verify-Metadata $stageDirectory $config
      $archive = Join-Path $stageDirectory "package.zip"
      if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256) {
        throw "Staged workflow package checksum rejected."
      }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $package = [IO.Compression.ZipFile]::OpenRead($archive)
      try {
        $entry = $package.GetEntry("WorkflowHost.cjs")
        if (!$entry) { throw "Workflow helper missing; run the latest installer." }
        $sourceStream = $entry.Open()
        $destination = [IO.File]::Create($workflowHost)
        try { $sourceStream.CopyTo($destination) } finally { $destination.Dispose(); $sourceStream.Dispose() }
      } finally { $package.Dispose() }
    }
    $nodePath = $config.nodePath
    if (!$nodePath -or !(Test-Path -LiteralPath $nodePath)) {
      $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
      if (!$nodeCommand) { throw "Node.js is required for BBox workflow processing." }
      $nodePath = $nodeCommand.Source
    }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $nodePath
    $info.Arguments = '"' + $workflowHost + '"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    [void]$process.Start()
    $process.StandardInput.Write(($request.request | ConvertTo-Json -Compress -Depth 80))
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(900000)) { $process.Kill(); throw "Workflow processing timed out." }
    if (!$output.Result) { throw "Workflow helper produced no result." }
    $result = $output.Result | ConvertFrom-Json
    if (!$result.ok) { throw $result.error }
    return @{ status = "workflow"; value = $result.value }
  }
  if ($config.repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "Update repository is not configured." }
  if ($request.extensionId -ne $config.extensionId -or !$request.installId -or $request.installId -ne $config.installId) {
    throw "Wrong extension installation directory. Load the extension from the installed MakerWorkflow folder."
  }
  $stage = Join-Path $root "stage"
  if ($request.action -eq "check") {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $base = "https://github.com/$($config.repository)/releases/latest/download"
    Download "$base/update.json" (Join-Path $stage "update.json")
    Download "$base/update.sig" (Join-Path $stage "update.sig")
    $meta = Verify-Metadata $stage $config
    if ([version]$meta.version -le [version]$request.version) { return @{ status = "current"; version = $request.version } }
    if ([version]$meta.version -lt [version]$installedManifest.version) { throw "Update would downgrade the installed extension." }
    if ($meta.asset -notmatch '^MakerWorkflow-[0-9.]+-Windows\.zip$') { throw "Invalid package filename." }
    $archive = Join-Path $stage "package.zip"
    if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $meta.sha256) {
      Download "$base/$($meta.asset)" $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $meta.sha256) { throw "Package checksum rejected." }
    return @{ status = "ready"; version = $meta.version }
  }
  if ($request.action -ne "apply") { throw "Unknown update action." }
  $meta = Verify-Metadata $stage $config
  if ($request.version -ne $meta.version) { throw "Staged version changed." }
  if ([version]$meta.version -lt [version]$installedManifest.version) { throw "Update would downgrade the installed extension." }
  $archive = Join-Path $stage "package.zip"
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $meta.sha256) { throw "Staged package checksum rejected." }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  $unpacked = Join-Path $stage ("unpacked-" + [Guid]::NewGuid().ToString("N"))
  try {
    foreach ($entry in $zip.Entries) {
      $resolved = [IO.Path]::GetFullPath((Join-Path $unpacked $entry.FullName))
      if (!$resolved.StartsWith($unpacked + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe archive path." }
    }
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $unpacked)
  } finally { $zip.Dispose() }
  $manifest = Get-Content -LiteralPath (Join-Path $unpacked "extension/manifest.json") -Raw | ConvertFrom-Json
  if ($manifest.version -ne $meta.version -or $manifest.key -ne $config.extensionKey) { throw "Extension identity mismatch." }
  $backup = Join-Path $root ("backup/" + [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss-fff"))
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root "extension") -Destination $backup -Recurse
  try {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $unpacked "extension") -File) {
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $root "extension") -Force
    }
    foreach ($name in @("Updater.ps1", "NativeHost.cmd", "WorkflowHost.cjs", "Bridge.cjs", "StartBridge.ps1", "NOTICE.md")) {
      Copy-Item -LiteralPath (Join-Path $unpacked $name) -Destination (Join-Path $root $name) -Force
    }
    if (!(Test-Path -LiteralPath (Join-Path $root "NativeHost.exe"))) {
      Copy-Item -LiteralPath (Join-Path $unpacked "NativeHost.exe") -Destination (Join-Path $root "NativeHost.exe")
    }
    $manifestPath = Join-Path $root "native-host.json"
    $hostManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $hostManifest.path = Join-Path $root "NativeHost.exe"
    [IO.File]::WriteAllText($manifestPath, ($hostManifest | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))
  } catch {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $backup "extension") -File) {
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $root "extension") -Force
    }
    throw
  }
  return @{ status = "installed"; version = $meta.version }
}
try {
  $length = [BitConverter]::ToUInt32((Read-Bytes 4), 0)
  if ($length -gt 33554432) { throw "Message too large." }
  $request = [Text.Encoding]::UTF8.GetString((Read-Bytes $length)) | ConvertFrom-Json
  $result = Run-Update $request
} catch { $result = @{ status = "error"; message = $_.Exception.Message } }
$reply = [Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Compress -Depth 100))
$header = [BitConverter]::GetBytes([uint32]$reply.Length)
$outputStream.Write($header, 0, 4)
$outputStream.Write($reply, 0, $reply.Length)
$outputStream.Flush()
