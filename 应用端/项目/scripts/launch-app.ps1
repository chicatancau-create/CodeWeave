$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'Programs/CodeWeave/CodeWeaveQtShell.exe'
if (Test-Path -LiteralPath $exe) {
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    $service = Join-Path $root '网页端/项目/scripts/ensure-local-service.mjs'
    $config = Join-Path $root '网页端/项目/server/config/codeweave.local.json'
    if (Test-Path -LiteralPath $config) {
        $settings = Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json
        $env:CODEWEAVE_UNIFIED_ORIGIN = 'http://127.0.0.1:' + [int]$settings.port
        $node = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($node -and (Test-Path -LiteralPath $service)) {
            $origin = & $node.Source $service
            if ($LASTEXITCODE -eq 0 -and $origin -match '^http://127\.0\.0\.1:\d+$') {
                $env:CODEWEAVE_UNIFIED_ORIGIN = $origin
            }
        }
    }
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
} else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        '当前机器尚未安装 CodeWeave 应用端。请先使用工程文件中的当前 Qt 构建命令编译，再按应用端工程文件完成部署安装。',
        'CodeWeave 应用端'
    ) | Out-Null
}
