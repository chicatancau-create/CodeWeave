$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'sign-qt-internal.ps1') -Files @(
    'G:\CodeWeave-qt\qt-release-candidate\CodeWeaveQtShell.exe',
    'G:\CodeWeave-qt\CodeWeaveQt-0.1.0-preview-setup.exe'
)
