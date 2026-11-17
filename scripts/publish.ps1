param([string]$Name = "Maker-plugins", [switch]$Public)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$account = & gh api user --jq .login 2>$null
if ($LASTEXITCODE -ne 0 -or !$account) { throw "GitHub login required. Run: gh auth login" }
$repository = "$account/$Name"
& gh repo view $repository --json name 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  if (!$Public) { throw "Automatic downloads require public release assets. Review visibility, then run this script with -Public." }
  & gh api --method POST user/repos -f "name=$Name" -F public=true -F auto_init=true `
    -f "description=Maker plugin - internal Windows installer and signed automatic updates" --silent
  if ($LASTEXITCODE -ne 0) { throw "Repository creation failed." }
}
$visibility = & gh repo view $repository --json visibility --jq .visibility
if ($visibility -ne "PUBLIC") { throw "This updater requires public release downloads; no access tokens are distributed." }
& node (Join-Path $PSScriptRoot "package-release.cjs") $repository
if ($LASTEXITCODE -ne 0) { throw "Packaging failed." }
$manifest = Get-Content -LiteralPath (Join-Path $root "extension/manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$notes = Join-Path $root "dist/release-notes.md"
@"
Maker plugin $version

Download MakerWorkflow-$version-Windows.zip, extract, run Install.cmd.
First installation requires loading the extension folder in browser developer mode once.
Later Maker canvas openings automatically check signed updates.
No AI generation is performed by the updater.
"@ | Set-Content -LiteralPath $notes -Encoding UTF8
& gh release create "v$version" --repo $repository --title "Maker plugin $version" --notes-file $notes `
  (Join-Path $root "dist/MakerWorkflow-$version-Windows.zip") `
  (Join-Path $root "dist/update.json") (Join-Path $root "dist/update.sig") `
  (Join-Path $root "dist/MakerWorkflow-$version-Source.zip")
if ($LASTEXITCODE -ne 0) { throw "Release publishing failed; do not report it as published." }
Write-Host "Published: https://github.com/$repository/releases/tag/v$version"
