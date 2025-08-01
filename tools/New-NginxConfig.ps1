param (
    [string]$type,
    [string]$port
)

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
$fqdn = $domainPrefix + '.by.vincent.mahn.ke'

if (-not (Get-Module -ListAvailable -Name EPS)) {
    Install-Module -Name EPS -Force -Scope CurrentUser
}
Import-Module EPS

$template = Get-Content -Raw -Path "../workflow/nginx_templates/$type.eps"

$outFile = "output/$fqdn.conf"
$nginxConfig = Invoke-EpsTemplate -Template $template -Binding @{
    fqdn         = $fqdn
    domainPrefix = $domainPrefix
    port         = $port
    CERT_HOME    = $env:CERT_HOME -replace '\\', '/'
}
if (Test-Path "output") {
    Remove-Item "output" -Recurse -Force
}
$outDir = Split-Path $outFile -Parent
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Set-Content -Path $outFile -Value $nginxConfig

Write-Host "NGINX config generated: $outFile"