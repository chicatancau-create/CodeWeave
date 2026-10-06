[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $PackageDir
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PackageDir -ErrorAction Stop).Path
$manifestPath = Join-Path $root 'manifest.json'
$old = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$files = @()
Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
    if ($_.Name -ne 'manifest.json') {
        $relative = $_.FullName.Substring($root.TrimEnd('\').Length + 1).Replace('\','/')
        $files += [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
}
$manifest = [ordered]@{ schemaVersion = 1; product = $old.product; architecture = $old.architecture; ui = $old.ui; version = $old.version; generatedAtUtc = [DateTime]::UtcNow.ToString('o'); files = $files }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output ('MANIFEST_FILES=' + $files.Count)
