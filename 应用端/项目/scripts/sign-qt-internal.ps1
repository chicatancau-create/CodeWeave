[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string[]] $Files,
    [string] $SigningDir = (Join-Path $PSScriptRoot '../../开发环境/signing')
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $SigningDir | Out-Null
$pfx = Join-Path $SigningDir 'CodeWeave-Internal-Test.pfx'
$cer = Join-Path $SigningDir 'CodeWeave-Internal-Test.cer'
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq 'CN=CodeWeave Internal Test' -and $_.HasPrivateKey } | Select-Object -First 1
if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=CodeWeave Internal Test' -FriendlyName 'CodeWeave Internal Test (not trusted)' -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(2)
}
if (-not (Test-Path $cer)) { Export-Certificate -Cert $cert -FilePath $cer | Out-Null }
if (-not (Test-Path $pfx)) {
    $password = ConvertTo-SecureString -String ('CodeWeave-internal-' + $cert.Thumbprint.Substring(0, 8)) -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $password -Force | Out-Null
}
$signtool = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse | Where-Object FullName -match '\\x64\\signtool.exe$' | Select-Object -First 1).FullName
foreach ($file in $Files) {
    $path = (Resolve-Path -LiteralPath $file -ErrorAction Stop).Path
    & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint $path
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $path" }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint) {
        throw "signature certificate mismatch for $path"
    }
    Write-Output ('SIGNED=' + $path + ' STATUS=' + $signature.Status)
}
Write-Output ('CERT_THUMBPRINT=' + $cert.Thumbprint)
Write-Output ('CERTIFICATE=' + $cer)
Write-Output ('PFX=' + $pfx)
