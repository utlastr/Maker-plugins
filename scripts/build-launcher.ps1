$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR "Microsoft.NET/Framework/v4.0.30319/csc.exe" }
if (!(Test-Path -LiteralPath $compiler)) { throw "Windows .NET Framework C# compiler is required to build the native launcher." }
& $compiler /nologo /target:exe /optimize+ /platform:anycpu `
  ("/out:" + (Join-Path $root "distribution/NativeHost.exe")) `
  (Join-Path $root "native/NativeHost.cs")
if ($LASTEXITCODE -ne 0) { throw "Native launcher build failed." }
