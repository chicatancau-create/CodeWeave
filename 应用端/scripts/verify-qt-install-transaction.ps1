[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$base = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$root = Join-Path $base ('cw-install-transaction-' + [guid]::NewGuid().ToString('N'))
$savedLocal = $env:LOCALAPPDATA
$savedApp = $env:APPDATA
$checks = @()
function Assert-True($Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}
function Write-Manifest([string] $Package, [string] $Version) {
    $files = @(Get-ChildItem -LiteralPath $Package -File | Where-Object Name -ne 'manifest.json' |
        ForEach-Object { @{ path=$_.Name; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
    @{ schemaVersion=1; product='CodeWeave'; architecture='x64'; version=$Version; files=$files } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Package 'manifest.json') -Encoding UTF8
}
function Run-Install([string] $Package, [bool] $Expected) {
    # Exercise the shipped Windows PowerShell 5.1 entry, not the caller's version.
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Package 'install-qt.ps1') 2>&1
    $code = $LASTEXITCODE
    if (($code -eq 0) -ne $Expected) { throw "Unexpected installer exit $code : $output" }
}
try {
    $package = Join-Path $root 'package'
    New-Item -ItemType Directory -Path $package -Force | Out-Null
    $env:LOCALAPPDATA = Join-Path $root 'local'
    $env:APPDATA = Join-Path $root 'roaming'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-qt.ps1') -Destination $package
    Set-Content -LiteralPath (Join-Path $package 'CodeWeaveQtShell.exe') -Value 'synthetic-v1'
    Set-Content -LiteralPath (Join-Path $package 'uninstall-qt.ps1') -Value '# synthetic test payload'
    Write-Manifest $package 'test-v1'
    Run-Install $package $true
    $target = Join-Path $env:LOCALAPPDATA 'Programs\CodeWeave'
    $exe = Join-Path $target 'CodeWeaveQtShell.exe'
    $v1 = (Get-FileHash -LiteralPath $exe).Hash
    $data = Join-Path $env:LOCALAPPDATA 'CodeWeave'
    New-Item -ItemType Directory -Path $data | Out-Null
    Set-Content -LiteralPath (Join-Path $data 'sentinel') -Value 'preserve'
    $checks += 'initial-install'

    Set-Content -LiteralPath (Join-Path $package 'CodeWeaveQtShell.exe') -Value 'synthetic-v2'
    Run-Install $package $false
    Assert-True ((Get-FileHash -LiteralPath $exe).Hash -eq $v1) 'Corrupt package changed installation'
    Write-Manifest $package 'test-v2'
    $checks += 'corrupt-payload-rejected'

    $unknown = Join-Path $package 'unlisted.txt'
    Set-Content -LiteralPath $unknown -Value 'preserve'
    Run-Install $package $false
    Remove-Item -LiteralPath $unknown
    $checks += 'unlisted-payload-rejected'

    $manifestPath = Join-Path $package 'manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.files += $manifest.files[0]
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Run-Install $package $false
    Write-Manifest $package 'test-v2'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest.files[0].path = '../outside.txt'
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Run-Install $package $false
    Assert-True ((Get-FileHash -LiteralPath $exe).Hash -eq $v1) 'Unsafe manifest changed installation'
    Write-Manifest $package 'test-v2'
    $checks += 'duplicate-and-traversal-manifest-rejected'

    $userFile = Join-Path $target 'user-file.txt'
    Set-Content -LiteralPath $userFile -Value 'preserve'
    Run-Install $package $false
    Assert-True ((Get-Content -LiteralPath $userFile -Raw).Trim() -eq 'preserve') 'Unmanaged file changed'
    Remove-Item -LiteralPath $userFile
    $checks += 'unmanaged-installed-file-preserved'

    # Force a real failure after directory swap by making the menu root a file.
    $menuBlock = Join-Path $root 'blocked-roaming'
    Set-Content -LiteralPath $menuBlock -Value 'not-a-directory'
    $env:APPDATA = $menuBlock
    Run-Install $package $false
    Assert-True ((Get-FileHash -LiteralPath $exe).Hash -eq $v1) 'Failed upgrade did not restore previous payload'
    Assert-True (@(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Directory).Count -eq 1) 'Staging or rollback directory leaked'
    $checks += 'post-swap-failure-restores-old-version'
    $env:APPDATA = Join-Path $root 'roaming'
    Run-Install $package $true
    Assert-True ((Get-FileHash -LiteralPath $exe).Hash -ne $v1) 'Upgrade did not change payload'
    Assert-True ((Get-Content -LiteralPath (Join-Path $data 'sentinel') -Raw).Trim() -eq 'preserve') 'User data changed'
    $checks += 'upgrade-data-preserved'
    Set-Content -LiteralPath (Join-Path $package 'CodeWeaveQtShell.exe') -Value 'synthetic-v1'
    Write-Manifest $package 'test-v1'
    Run-Install $package $true
    Assert-True ((Get-FileHash -LiteralPath $exe).Hash -eq $v1) 'Explicit version rollback failed'
    Assert-True ((Get-Content -LiteralPath (Join-Path $data 'sentinel') -Raw).Trim() -eq 'preserve') 'Rollback changed user data'
    $checks += 'explicit-version-rollback-data-preserved'
    @{ status='passed'; checks=$checks; scope='isolated synthetic payload; Windows PowerShell installer transaction' } | ConvertTo-Json
}
finally {
    $env:LOCALAPPDATA = $savedLocal
    $env:APPDATA = $savedApp
    $resolved = [IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $resolved -Leaf) -match '^cw-install-transaction-[0-9a-f]{32}$') {
        if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
    } else { throw 'Unsafe test cleanup path' }
}
