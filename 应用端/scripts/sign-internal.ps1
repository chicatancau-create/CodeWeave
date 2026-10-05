param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$Thumbprint,
  [Parameter(Mandatory=$true)][string]$SignTool
)
$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $Executable).Path
$tool = (Resolve-Path -LiteralPath $SignTool).Path
$cert = Get-Item -LiteralPath ('Cert:/CurrentUser/My/' + $Thumbprint)
if (!$cert.HasPrivateKey) { throw 'Signing certificate has no private key.' }
if ($cert.NotAfter -le (Get-Date)) { throw 'Signing certificate expired.' }
& $tool sign /fd SHA256 /sha1 $Thumbprint $target
if ($LASTEXITCODE -ne 0) { throw 'SignTool signing failed.' }
$signature = Get-AuthenticodeSignature -LiteralPath $target
if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint) {
  throw 'Unexpected signature certificate.'
}
$signature | Select-Object Path,Status,StatusMessage
& $tool verify /pa /v $target
$verificationExit = $LASTEXITCODE
Write-Output ('Trust verification exit code: ' + $verificationExit)
Write-Output 'Self-signing does not grant public trust or SmartScreen reputation. This script never changes trust stores.'
exit $verificationExit
