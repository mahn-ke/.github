$ErrorActionPreference = 'stop'

$repo = [System.Environment]::GetEnvironmentVariable("GITHUB_REPOSITORY")
if (-not $repo) {
    Write-Host "GITHUB_REPOSITORY environment variable is not set."
    exit 0
}
$repoName = $repo.Split('/')[1]
if ($repoName -notlike '*-by-vincent*') {
    Write-Host "Repository does not contain '-by-vincent'. No subdomain is requested."
    exit 0
}
$domainPrefix = (($repoName -replace '-by-vincent', '') -replace '-', '.')

# Ensure directories exist
$certsPath = Join-Path $env:CERT_HOME "certs"
$wellKnownPath = Join-Path $env:CERT_HOME ".well-known\$domainPrefix"
New-Item -ItemType Directory -Path $certsPath -Force | Out-Null
New-Item -ItemType Directory -Path $wellKnownPath -Force | Out-Null

# Path to wacs.exe (assumed to be in tools directory)
$wacsPath = Join-Path $env:ACME_HOME "wacs.exe"

# Run WACS to create certificate
Write-Output "Setting up certificate renewal for $domainPrefix..."
Push-Location $env:ACME_HOME
$arguments = "--target manual --host $domainPrefix.by.vincent.mahn.ke --store pemfiles --pemfilespath $certsPath --validation filesystem --webroot $wellKnownPath --accepttos"
Write-Output "Starting in '$PWD': '$wacsPath $arguments'"
$process = Start-Process -FilePath $wacsPath -ArgumentList $arguments -Wait -NoNewWindow -PassThru
Pop-Location
Write-Output "WACS process completed with exit code: $($process.ExitCode)"

if ($process.ExitCode -ne 0) {
    Write-Error "Certificate renewal failed for $domainPrefix."
} else {
    Write-Host "Certificate successfully renewed for $domainPrefix in $certsPath."
}