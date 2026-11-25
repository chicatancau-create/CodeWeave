[CmdletBinding()]
param([switch] $Check, [switch] $Headless)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repo = [IO.Path]::GetFullPath((Join-Path $project '../..'))
$apk = Join-Path $project 'mobile-app/build/outputs/apk/debug/mobile-app-debug.apk'
$sdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android/Sdk')) |
    Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'emulator/emulator.exe')) } | Select-Object -First 1
if ($Check) {
    [pscustomobject]@{ Apk = Test-Path -LiteralPath $apk; Emulator = [bool]$sdk }
    exit 0
}
if (!(Test-Path -LiteralPath $apk) -or !$sdk) { throw '需要本机构建的 APK 和 Android 模拟器。' }
$emulator = Join-Path $sdk 'emulator/emulator.exe'
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$avd = $env:CODEWEAVE_ANDROID_AVD
if (!$avd) {
    $installed = @(& $emulator -list-avds | Where-Object { $_ -match '^[A-Za-z0-9_.-]+$' })
    if ($installed.Count -ne 1) { throw '请通过 CODEWEAVE_ANDROID_AVD 配置用于本机学习的模拟器。' }
    $avd = $installed[0]
}
if ($avd -notmatch '^[A-Za-z0-9_.-]+$') { throw '模拟器名称无效。' }
$node = (Get-Command node.exe).Source
$origin = & $node (Join-Path $repo '网页端/项目/scripts/ensure-local-service.mjs')
if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^http://127\.0\.0\.1:(\d+)$') { throw '本机统一服务未就绪。' }
$emulatorOrigin = 'http://10.0.2.2:' + $Matches[1]
$serial = 'emulator-5584'
$devices = & $adb devices
if (-not ($devices -match ('^' + $serial + '\s'))) {
    $arguments = @('-avd', $avd, '-no-snapshot', '-port', '5584')
    if ($Headless) { $arguments += @('-no-window', '-no-audio', '-gpu', 'swiftshader_indirect') }
    $emulatorProcess = Start-Process -FilePath $emulator -ArgumentList $arguments -WindowStyle Hidden -PassThru
}
$booted = $false
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if ($emulatorProcess -and $emulatorProcess.HasExited) { throw 'Android 模拟器启动失败。' }
    $booted = (& $adb -s $serial shell getprop sys.boot_completed 2>$null) -eq '1'
    if ($booted) { break }
    Start-Sleep -Seconds 2
}
if (!$booted) { throw 'Android 模拟器启动超时。' }
$liveAvd = (& $adb -s $serial emu avd name | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0 -or $liveAvd -ne $avd) { throw '模拟器端口由另一个 AVD 使用。' }
& $adb -s $serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw '移动端安装失败。' }
& $adb -s $serial shell am start -W -n com.codeweave.mobile/.MainActivity --es codeweaveOrigin $emulatorOrigin
if ($LASTEXITCODE -ne 0) { throw '移动端启动失败。' }
