param (
    [Parameter(Mandatory)]
    [PSCustomObject]$data
)

$ErrorActionPreference = 'stop'

$type = $data.type

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

$nginxConf = "$env:NGINX_HOME\conf"
$backupDir = "$nginxConf-backup"
$output = "$(Get-Location)\output"
$destination = "$nginxConf\$type"
if ($type -like "*_ssl") {
    $destination = "$nginxConf\http"
}

Write-Host "Backing up current NGINX configuration..."
Copy-Item -Path $nginxConf -Destination $backupDir -Recurse -Force

Write-Host "Generating NGINX configuration:"
Copy-Item -Path $output\* -Destination $destination -Recurse -Force

Write-Host "Reloading NGINX configuration..."
Push-Location $env:NGINX_HOME
nginx -s reload
Pop-Location
$exitCode = $LASTEXITCODE
Write-Host "NGINX reload exit code: $exitCode"

if ($exitCode -eq 0) {
    # Success: remove backup
    Remove-Item -Path $backupDir -Recurse -Force
    Write-Host "NGINX configuration updated successfully."
} else {
    # Failure: restore backup contents and remove backup
    Write-Host "NGINX configuration update failed. Restoring backup..."
    Remove-Item -Path "$nginxConf\*" -Recurse -Force
    Copy-Item -Path "$backupDir\*" -Destination $nginxConf -Recurse -Force
    Remove-Item -Path $backupDir -Recurse -Force
    Write-Host "Backup contents restored. Please check the NGINX logs for details."
}

exit $exitCode