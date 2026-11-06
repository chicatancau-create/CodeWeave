[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$local = Join-Path $root '.local'
New-Item -ItemType Directory -Path $local -Force | Out-Null
$aliases = @{
    app = '应用端/项目'
    prep = '应用端/开发环境/CodeWeave-prep'
    qt = '应用端/构建产物/qt'
}
foreach ($name in $aliases.Keys) {
    $target = Join-Path $root $aliases[$name]
    if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
    $path = Join-Path $local $name
    if (Test-Path -LiteralPath $path) {
        $entry = Get-Item -LiteralPath $path -Force
        if ($entry.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath($entry.Target) -ne [IO.Path]::GetFullPath($target)) {
            throw "Refusing to replace existing path: $path"
        }
    } else { New-Item -ItemType Junction -Path $path -Target $target | Out-Null }
}
$shell = New-Object -ComObject WScript.Shell
$web = $shell.CreateShortcut((Join-Path $root '网页端/启动网页端.lnk'))
$web.TargetPath = $env:ComSpec
$web.Arguments = '/d /c ""' + (Join-Path $root '网页端/项目/scripts/launch-web.cmd') + '""'
$web.WorkingDirectory = Join-Path $root '网页端/项目'
$web.Description = '启动 CodeWeave 网页端'
$web.Save()
$mobile = $shell.CreateShortcut((Join-Path $root '移动端/启动移动端.lnk'))
$mobile.TargetPath = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $mobile.TargetPath)) { $mobile.TargetPath = (Get-Command powershell.exe).Source }
$mobile.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root '移动端/项目/scripts/launch-mobile.ps1') + '"'
$mobile.WorkingDirectory = Join-Path $root '移动端/项目'
$mobile.Description = '打开 CodeWeave 移动端 Android 工程（无 APK 时明确提示）'
$mobile.Save()
$appExe = Join-Path $env:LOCALAPPDATA 'Programs/CodeWeave/CodeWeaveQtShell.exe'
if (Test-Path -LiteralPath $appExe) {
    $app = $shell.CreateShortcut((Join-Path $root '应用端/启动应用端.lnk'))
    $app.TargetPath = $appExe
    $app.WorkingDirectory = Split-Path $appExe
    $app.Description = '启动当前已安装的 CodeWeave 应用端'
    $app.Save()
} else {
    $app = $shell.CreateShortcut((Join-Path $root '应用端/启动应用端.lnk'))
    $app.TargetPath = $mobile.TargetPath
    $app.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root '应用端/项目/scripts/launch-app.ps1') + '"'
    $app.WorkingDirectory = Join-Path $root '应用端/项目'
    $app.Description = 'CodeWeave 应用端（未安装时显示说明）'
    $app.Save()
    Write-Warning '当前机器未安装 CodeWeave Qt 应用；入口将显示安装说明。'
}
foreach ($name in @('.git', '.gitignore', '.gitattributes', 'AGENTS.md', '.claude', '.local')) {
    $path = Join-Path $root $name
    if (Test-Path -LiteralPath $path) {
        $item = Get-Item -LiteralPath $path -Force
        $item.Attributes = $item.Attributes -bor [IO.FileAttributes]::Hidden
    }
}
Write-Output 'Local aliases and launch shortcuts are ready.'
