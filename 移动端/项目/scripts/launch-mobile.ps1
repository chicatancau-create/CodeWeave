[CmdletBinding()]
param([switch] $Check)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Test-Path -LiteralPath (Join-Path $project 'settings.gradle.kts'))) { throw 'Android 工程文件缺失。' }
$studio = @(
    (Join-Path $env:ProgramFiles 'Android/Android Studio/bin/studio64.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs/Android Studio/bin/studio64.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($Check) {
    Write-Output ('Mobile project ready; Android Studio installed: ' + [bool]$studio)
    exit 0
}
if ($studio) {
    Start-Process -FilePath $studio -ArgumentList ('"' + $project + '"') -WorkingDirectory $project
} else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        '当前移动端只有 Android 源码，尚无可运行 APK，也未检测到 Android Studio。请安装 Android Studio 后打开本目录；不会自动向连接的手机安装或发送命令。',
        'CodeWeave 移动端'
    ) | Out-Null
    Start-Process explorer.exe -ArgumentList ('"' + $project + '"')
}
