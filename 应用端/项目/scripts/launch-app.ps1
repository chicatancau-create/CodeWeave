$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'Programs/CodeWeave/CodeWeaveQtShell.exe'
if (Test-Path -LiteralPath $exe) {
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
} else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        '当前机器尚未安装 CodeWeave 应用端。请先使用工程文件中的当前 Qt 构建命令编译，再按应用端工程文件完成部署安装。',
        'CodeWeave 应用端'
    ) | Out-Null
}
