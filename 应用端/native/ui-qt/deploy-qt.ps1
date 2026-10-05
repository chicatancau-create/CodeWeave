[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Exe,

    [Parameter(Mandatory = $true)]
    [string] $OutputDir,

    [Parameter(Mandatory = $true)]
    [string] $QmlDir,

    [Parameter(Mandatory = $true)]
    [string] $ContentDir,

    [string] $QtBin = ""
)

$ErrorActionPreference = "Stop"

function Resolve-ExistingFile([string] $Path, [string] $Name) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "$Name 不是文件: $resolved"
    }
    return $resolved.Path
}

$exePath = Resolve-ExistingFile $Exe "Qt EXE"
$qmlPath = (Resolve-Path -LiteralPath $QmlDir -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $qmlPath -PathType Container)) {
    throw "QML 源目录不存在: $qmlPath"
}
$contentPath = (Resolve-Path -LiteralPath $ContentDir -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $contentPath -PathType Container)) {
    throw "内容目录不存在: $contentPath"
}

if ([string]::IsNullOrWhiteSpace($QtBin)) {
    $qtBinPath = Split-Path -Parent (Get-Command windeployqt.exe -ErrorAction Stop).Source
} else {
    $qtBinPath = (Resolve-Path -LiteralPath $QtBin -ErrorAction Stop).Path
}
$deployTool = Resolve-ExistingFile (Join-Path $qtBinPath "windeployqt.exe") "windeployqt"

$outputPath = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Copy-Item -LiteralPath $exePath -Destination (Join-Path $outputPath (Split-Path -Leaf $exePath)) -Force
$contentOutput = Join-Path $outputPath "content"
New-Item -ItemType Directory -Force -Path $contentOutput | Out-Null
Get-ChildItem -LiteralPath $contentPath | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $contentOutput -Recurse -Force
}

& $deployTool --release --compiler-runtime --no-translations --qmldir $qmlPath --dir $outputPath $exePath
if ($LASTEXITCODE -ne 0) {
    throw "windeployqt 失败，退出码: $LASTEXITCODE"
}

$requiredFiles = @(
    "CodeWeaveQtShell.exe",
    "Qt6Core.dll",
    "Qt6Gui.dll",
    "Qt6Qml.dll",
    "Qt6Quick.dll",
    "Qt6QuickControls2.dll",
    "qml\QtQuick\Controls\qmldir",
    "platforms\qwindows.dll"
)
foreach ($relativePath in $requiredFiles) {
    $candidate = Join-Path $outputPath $relativePath
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Qt 部署缺少必需文件: $relativePath"
    }
}

$qmlModulePath = Join-Path $outputPath "qml\QtQuick"
if (-not (Test-Path -LiteralPath $qmlModulePath -PathType Container)) {
    throw "Qt 部署缺少 QtQuick QML 模块: $qmlModulePath"
}
if (-not (Test-Path -LiteralPath (Join-Path $outputPath "content\catalog.v1.tsv") -PathType Leaf)) {
    throw "Qt 部署缺少内容清单: content\catalog.v1.tsv"
}

Write-Host "Qt 部署验证通过: $outputPath"
