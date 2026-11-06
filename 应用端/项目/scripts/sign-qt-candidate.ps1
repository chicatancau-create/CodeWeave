$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'sign-qt-internal.ps1') -Files @(
    (Join-Path $PSScriptRoot '../../../构建产物/qt/current/qt-deploy/CodeWeaveQtShell.exe'),
    (Join-Path $PSScriptRoot '../../../构建产物/qt/current/package/CodeWeaveQt-setup.exe')
)
