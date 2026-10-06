[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Exe,
    [Parameter(Mandatory = $true)] [string] $OutputDir,
    [Parameter(Mandatory = $true)] [string] $QmlDir,
    [Parameter(Mandatory = $true)] [string] $ContentDir,
    [Parameter(Mandatory = $true)] [string] $ConfigDir,
    [string] $QtBin = '',
    [string] $RuntimeDir = ''
)
$ErrorActionPreference = 'Stop'
function Resolve-ExistingFile([string] $Path, [string] $Name) {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "$Name is not a file: $resolved" }
    return $resolved.Path
}
$exePath = Resolve-ExistingFile $Exe 'Qt executable'
$qmlPath = (Resolve-Path -LiteralPath $QmlDir -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $qmlPath -PathType Container)) { throw "QML source directory missing: $qmlPath" }
$contentPath = (Resolve-Path -LiteralPath $ContentDir -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $contentPath -PathType Container)) { throw "content directory missing: $contentPath" }
$configPath = (Resolve-Path -LiteralPath $ConfigDir -ErrorAction Stop).Path
$configMarker = Join-Path $configPath 'codeweave.config.example.json'
if (-not (Test-Path -LiteralPath $configMarker -PathType Leaf)) { throw 'workspace config marker missing' }
if ([string]::IsNullOrWhiteSpace($QtBin)) { $qtBinPath = Split-Path -Parent (Get-Command windeployqt.exe -ErrorAction Stop).Source } else { $qtBinPath = (Resolve-Path -LiteralPath $QtBin -ErrorAction Stop).Path }
$deployTool = Resolve-ExistingFile (Join-Path $qtBinPath 'windeployqt.exe') 'windeployqt'
$outputPath = [System.IO.Path]::GetFullPath($OutputDir)
if ((Test-Path -LiteralPath $outputPath) -and (Get-ChildItem -LiteralPath $outputPath -Force | Select-Object -First 1)) {
    throw 'Deployment requires an empty output directory; use a fresh build artifact directory.'
}
# Use only Microsoft's redistributable CRT directory, never System32 or a
# developer/debug runtime. Windows 10/11 supply the Universal CRT themselves.
if ([string]::IsNullOrWhiteSpace($RuntimeDir)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vs) { throw 'MSVC redistributables not found; pass -RuntimeDir.' }
    $RuntimeDir = Get-ChildItem -LiteralPath (Join-Path $vs 'VC\Redist\MSVC') -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
    $RuntimeDir = Join-Path $RuntimeDir 'x64\Microsoft.VC143.CRT'
}
$runtimePath = (Resolve-Path -LiteralPath $RuntimeDir).Path
foreach ($runtime in @('msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll')) {
    $null = Resolve-ExistingFile (Join-Path $runtimePath $runtime) 'MSVC release runtime'
}
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Copy-Item -LiteralPath $exePath -Destination (Join-Path $outputPath (Split-Path -Leaf $exePath)) -Force
$contentOutput = Join-Path $outputPath 'content'
New-Item -ItemType Directory -Force -Path $contentOutput | Out-Null
Get-ChildItem -LiteralPath $contentPath | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $contentOutput -Recurse -Force }
& $deployTool --release --no-compiler-runtime --no-translations --skip-plugin-types qmltooling --qmldir $qmlPath --dir $outputPath $exePath
if ($LASTEXITCODE -ne 0) { throw "windeployqt failed: $LASTEXITCODE" }
Get-ChildItem -LiteralPath $runtimePath -Filter '*.dll' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $outputPath
}
# QML debugger plugins (including qmldbg_tcp) are development-only and must
# never be present in a runnable deployment tree.
$qmlToolingPath = Join-Path $outputPath 'qmltooling'
if (Test-Path -LiteralPath $qmlToolingPath) { Remove-Item -LiteralPath $qmlToolingPath -Recurse -Force }
if (Test-Path -LiteralPath $qmlToolingPath) { throw 'qmltooling must not be present in deployment output' }
$requiredFiles = @('CodeWeaveQtShell.exe','Qt6Core.dll','Qt6Gui.dll','Qt6Qml.dll','Qt6Quick.dll','Qt6QuickControls2.dll','qml\QtQuick\Controls\Basic\qmldir','platforms\qwindows.dll','msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll')
foreach ($relativePath in $requiredFiles) { $candidate = Join-Path $outputPath $relativePath; if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "required deployment file missing: $relativePath" } }
$qmlModulePath = Join-Path $outputPath 'qml\QtQuick'
if (-not (Test-Path -LiteralPath $qmlModulePath -PathType Container)) { throw "QtQuick QML module missing: $qmlModulePath" }
$catalog = Join-Path $outputPath 'content\catalog.v1.tsv'
if (-not (Test-Path -LiteralPath $catalog -PathType Leaf)) { throw 'content catalog missing' }
$configOutput = Join-Path $outputPath 'config'
New-Item -ItemType Directory -Force -Path $configOutput | Out-Null
Copy-Item -LiteralPath $configMarker -Destination (Join-Path $configOutput 'codeweave.config.example.json') -Force
Write-Host "Qt deployment verified: $outputPath"
