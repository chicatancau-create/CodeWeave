[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Installer,
    [switch] $IncludeUpgrade,
    [string] $PreviousInstaller = ''
)
$ErrorActionPreference = 'Stop'
$sandbox = Join-Path $env:TEMP ('codeweave-lifecycle-' + [guid]::NewGuid().ToString('N'))
$local = Join-Path $sandbox 'local'
$app = Join-Path $sandbox 'appdata'
$temp = Join-Path $sandbox 'temp'
New-Item -ItemType Directory -Force -Path $local, $app, $temp | Out-Null
$oldLocal=$env:LOCALAPPDATA; $oldApp=$env:APPDATA; $oldPlatform=$env:QT_QPA_PLATFORM
$oldTemp=$env:TEMP; $oldTmp=$env:TMP
try {
    $env:LOCALAPPDATA=$local; $env:APPDATA=$app
    # Keep installer payloads and diagnostics inside this test's cleanup boundary.
    $env:TEMP=$temp; $env:TMP=$temp
    $firstInstaller = if ($PreviousInstaller) { $PreviousInstaller } else { $Installer }
    $p=Start-Process -FilePath $firstInstaller -PassThru
    if(-not $p.WaitForExit(30000)){ $p.Kill(); throw 'install timeout' }
    if($p.ExitCode -ne 0){ throw "install exit $($p.ExitCode)" }
    if (@(Get-ChildItem -LiteralPath $temp -Force).Count -ne 0) { throw 'installer left temporary payloads' }
    $target=Join-Path $local 'Programs\CodeWeave'
    $exe=Join-Path $target 'CodeWeaveQtShell.exe'
    if(-not(Test-Path $exe)){ throw 'install exe missing' }
    $data=Join-Path $local 'CodeWeave'
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    Set-Content -LiteralPath (Join-Path $data 'sentinel.txt') -Value 'preserve' -Encoding utf8
    if ($IncludeUpgrade) {
        $before = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
        $upgrade=Start-Process -FilePath $Installer -PassThru
        if(-not $upgrade.WaitForExit(30000)){ $upgrade.Kill(); throw 'upgrade timeout' }
        if($upgrade.ExitCode -ne 0){ throw "upgrade exit $($upgrade.ExitCode)" }
        if (@(Get-ChildItem -LiteralPath $temp -Force).Count -ne 0) { throw 'upgrade left temporary payloads' }
        if(-not(Test-Path (Join-Path $data 'sentinel.txt'))){ throw 'user data lost during upgrade' }
        $after = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
        if ($PreviousInstaller -and $before -eq $after) { throw 'Cross-version upgrade did not change application hash' }
        if ((Get-Content -LiteralPath (Join-Path $data 'sentinel.txt') -Raw).Trim() -ne 'preserve') { throw 'User data changed' }
        Write-Output "UPGRADE=PASS BEFORE_SHA256=$before AFTER_SHA256=$after"
    }
    $env:QT_QPA_PLATFORM='windows'
    $shot=Join-Path $sandbox 'lifecycle.png'
    $q=Start-Process -FilePath $exe -ArgumentList '--smoke-screenshot',$shot -WorkingDirectory $target -PassThru
    if(-not $q.WaitForExit(20000)){ $q.Kill(); throw 'installed smoke timeout' }
    if($q.ExitCode -ne 0 -or -not(Test-Path $shot)){ throw "installed smoke failed $($q.ExitCode)" }
    $uninstall=Join-Path $target 'uninstall-qt.ps1'
    if(-not(Test-Path $uninstall)){ throw 'uninstall script missing' }
    $u=Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstall -WindowStyle Hidden -PassThru
    if(-not $u.WaitForExit(10000)){ $u.Kill(); throw 'uninstall command timeout' }
    Start-Sleep -Seconds 2
    if(Test-Path $target){ throw 'program directory not removed' }
    if(-not(Test-Path (Join-Path $data 'sentinel.txt'))){ throw 'user data not preserved' }
    Write-Output 'INSTALL_LIFECYCLE_GREEN'
    Write-Output 'INSTALL=PASS'
    Write-Output 'SMOKE=PASS'
    Write-Output 'UNINSTALL=PASS'
    Write-Output 'DATA_PRESERVED=PASS'
    Write-Output 'INSTALLER_TEMP_CLEANUP=PASS'
}
catch {
    Get-ChildItem -LiteralPath $temp -Recurse -Filter 'error.txt' -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Output (Get-Content -LiteralPath $_.FullName -Raw) }
    throw
}
finally {
    $env:LOCALAPPDATA=$oldLocal; $env:APPDATA=$oldApp; $env:QT_QPA_PLATFORM=$oldPlatform
    $env:TEMP=$oldTemp; $env:TMP=$oldTmp
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
