[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $DeployDir,
    [Parameter(Mandatory = $true)] [string] $OutputDir,
    [string] $Version = '0.1.0-qt-preview'
)
$ErrorActionPreference = 'Stop'
$deploy = (Resolve-Path -LiteralPath $DeployDir -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath (Join-Path $deploy 'CodeWeaveQtShell.exe') -PathType Leaf)) { throw 'Qt executable missing' }
$output = [System.IO.Path]::GetFullPath($OutputDir)
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Force -Path $output | Out-Null
Get-ChildItem -LiteralPath $deploy -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $output -Recurse -Force }
# qmltooling contains developer debugger plugins (including qmldbg_tcp); the
# shipped application never enables QML debugging, so keep it out of runtime.
$qmlTooling = Join-Path $output 'qmltooling'
if (Test-Path -LiteralPath $qmlTooling) { Remove-Item -LiteralPath $qmlTooling -Recurse -Force }
$licenseDir = Join-Path $output 'licenses'
New-Item -ItemType Directory -Force -Path $licenseDir | Out-Null
@'
CodeWeave Qt 运行时许可说明（内部预览）

本目录使用 Qt 6.8.3 的动态链接运行时。Qt 相关组件按其随附许可提供；本产品不把 Qt 静态链接进核心库。
交付时应同时提供对应 Qt 版本的 LGPL 文本、版权声明、源代码获取方式以及允许用户替换/重新链接 Qt DLL 的说明。
当前构建使用 Qt SDK 自带 SBOM 作为组件清单来源，正式公开发布前由负责人复核许可证文本和源码对应版本。

组件来源：G:\CodeWeave-prep\qt\6.8.3\msvc2022_64\sbom\
官方许可入口：https://www.qt.io/licensing/
'@ | Set-Content -LiteralPath (Join-Path $licenseDir 'Qt-LGPL-Notice.txt') -Encoding utf8
$uninstall = @'
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$target = Split-Path -Parent $PSCommandPath
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CodeWeave'
Remove-Item -LiteralPath $startMenu -Recurse -Force -ErrorAction SilentlyContinue
$cleanup = "Start-Sleep -Milliseconds 300; Remove-Item -LiteralPath '" + $target.Replace("'", "''") + "' -Recurse -Force -ErrorAction SilentlyContinue"
Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',$cleanup -WindowStyle Hidden
'@
Set-Content -LiteralPath (Join-Path $output 'uninstall-qt.ps1') -Value $uninstall -Encoding utf8
$files = @()
Get-ChildItem -LiteralPath $output -Recurse -File | ForEach-Object {
    if ($_.Name -ne 'manifest.json') {
        $relative = $_.FullName.Substring($output.TrimEnd('\').Length + 1).Replace('\','/')
        $files += [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
}
$manifest = [ordered]@{ schemaVersion = 1; product = 'CodeWeave'; architecture = 'x64'; ui = 'Qt6/QML'; version = $Version; generatedAtUtc = [DateTime]::UtcNow.ToString('o'); files = $files }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding utf8
Write-Host "Qt release package created: $output"
