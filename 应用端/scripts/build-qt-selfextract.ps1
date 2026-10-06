[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $PackageDir,
    [Parameter(Mandatory = $true)] [string] $OutputExe
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputExe) { throw 'Installer output already exists; use a new artifact path.' }
$package = (Resolve-Path -LiteralPath $PackageDir -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath (Join-Path $package 'CodeWeaveQtShell.exe') -PathType Leaf)) { throw 'Qt package executable missing' }
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('codeweave-selfextract-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $root | Out-Null
try {
    $zip = Join-Path $root 'package.zip'
    Compress-Archive -Path (Join-Path $package '*') -DestinationPath $zip -CompressionLevel Optimal
    $compiler = (Get-Command g++.exe -ErrorAction Stop).Source
    $bootstrap = Join-Path $PSScriptRoot 'qt-installer-bootstrap.cpp'
    $launcher = Join-Path $root 'CodeWeaveQtSetup.exe'
    & $compiler '-std=c++23' '-O2' '-static' '-static-libgcc' '-static-libstdc++' '-mwindows' '-municode' $bootstrap '-lcrypt32' '-o' $launcher
    if ($LASTEXITCODE -ne 0) { throw "bootstrap compile failed: $LASTEXITCODE" }
    $marker = [Text.Encoding]::ASCII.GetBytes('CWQTZIP1')
    $launcherBytes = [IO.File]::ReadAllBytes($launcher)
    $zipBytes = [IO.File]::ReadAllBytes($zip)
    $output = [IO.Path]::GetFullPath($OutputExe)
    $stream = [IO.File]::Open($output, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($launcherBytes, 0, $launcherBytes.Length)
        $stream.Write($marker, 0, $marker.Length)
        $stream.Write($zipBytes, 0, $zipBytes.Length)
    } finally { $stream.Dispose() }
    Write-Output "Self-extracting installer created: $output"
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
