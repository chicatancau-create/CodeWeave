[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
function Get-PayloadHash([string] $Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
function Remove-InstallTree([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $full = [IO.Path]::GetFullPath($Path)
    $full = if ($full.StartsWith('\\')) { '\\?\UNC\' + $full.Substring(2) } else { '\\?\' + $full }
    [IO.Directory]::Delete($full, $true)
}
$source = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne 'CodeWeave' -or
    $manifest.architecture -ne 'x64' -or @($manifest.files).Count -eq 0) { throw 'Wrong package identity' }
$packagePaths = @{}
foreach ($entry in $manifest.files) {
    if (-not $entry.path -or $entry.path -match '(^[/\\]|:|(^|[/\\])\.\.([/\\]|$))' -or
        $entry.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Unsafe manifest entry' }
    $path = [IO.Path]::GetFullPath((Join-Path $source $entry.path))
    if (-not $path.StartsWith($source.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe manifest path' }
    if ($packagePaths.ContainsKey($path)) { throw 'Duplicate manifest path' }
    $packagePaths[$path] = $true
    if ((Get-PayloadHash $path) -ne $entry.sha256) { throw "Package hash mismatch: $($entry.path)" }
}
foreach ($item in Get-ChildItem -LiteralPath $source -Recurse -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package contains a reparse point' }
    if (-not $item.PSIsContainer -and $item.FullName -ne (Join-Path $source 'manifest.json') -and
        -not $packagePaths.ContainsKey($item.FullName)) { throw 'Package contains an unlisted file' }
}
foreach ($required in @('CodeWeaveQtShell.exe', 'install-qt.ps1', 'uninstall-qt.ps1')) {
    if (-not $packagePaths.ContainsKey((Join-Path $source $required))) { throw "Required package file missing: $required" }
}
$programs = Join-Path $env:LOCALAPPDATA 'Programs'
$target = Join-Path $programs 'CodeWeave'
$suffix = [guid]::NewGuid().ToString('N')
$stage = Join-Path $programs ('CodeWeave-stage-' + $suffix)
$rollback = Join-Path $programs ('CodeWeave-rollback-' + $suffix)
$swapped = $false
$hadPrevious = Test-Path -LiteralPath $target
if ($hadPrevious) {
    if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Installation target must not be a reparse point'
    }
    $oldManifest = Join-Path $target 'manifest.json'
    if (-not (Test-Path -LiteralPath $oldManifest) -or
        (Get-Content -LiteralPath $oldManifest -Raw | ConvertFrom-Json).product -ne 'CodeWeave') {
        throw 'Existing target is not a verified CodeWeave installation'
    }
    $known = @('manifest.json') + @((Get-Content -LiteralPath $oldManifest -Raw | ConvertFrom-Json).files.path)
    foreach ($existing in Get-ChildItem -LiteralPath $target -Recurse -Force) {
        if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Existing installation contains a reparse point' }
        if ($existing.PSIsContainer) { continue }
        $relative = $existing.FullName.Substring($target.Length + 1).Replace('\', '/')
        if ($relative -notin $known) { throw "Unmanaged file in installation; preserve it before upgrade: $relative" }
    }
    # Do not partially update files loaded by an active application.
    $running = Get-Process -Name CodeWeaveQtShell -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.Equals((Join-Path $target 'CodeWeaveQtShell.exe'), [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { throw 'Close CodeWeave before upgrading; no files were replaced' }
}
try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse }
    if ($hadPrevious) { Move-Item -LiteralPath $target -Destination $rollback }
    Move-Item -LiteralPath $stage -Destination $target
    $swapped = $true
    $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CodeWeave'
    New-Item -ItemType Directory -Path $menu -Force | Out-Null
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $menu 'CodeWeave.lnk'))
    $shortcut.TargetPath = Join-Path $target 'CodeWeaveQtShell.exe'
    $shortcut.WorkingDirectory = $target
    $shortcut.Save()
} catch {
    # All mutation paths are fixed direct children of this user's Programs.
    if ($swapped -and (Test-Path -LiteralPath $target)) { Remove-InstallTree $target }
    if (Test-Path -LiteralPath $rollback) { Move-Item -LiteralPath $rollback -Destination $target }
    throw
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-InstallTree $stage }
}
# Only the verified previous program payload is retired; user data is a sibling
# of Programs and never participates in this transaction.
if (Test-Path -LiteralPath $rollback) { Remove-InstallTree $rollback }
