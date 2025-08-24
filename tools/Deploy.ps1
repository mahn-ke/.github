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

function Get-PortInfo {
    $composeFile = "docker-compose.yml"

    # Ensure powershell-yaml module is installed and imported
    if (-not (Get-Module -ListAvailable -Name powershell-yaml)) {
        Install-Module -Name powershell-yaml -Force -Scope CurrentUser
    }
    Import-Module powershell-yaml

    if (-not (Test-Path $composeFile)) {
        Write-Error "docker-compose.yml not found"
        exit 1
    }

    $firstLine = (Get-Content $composeFile -First 1).Trim()
    if (-not ($firstLine -and $firstLine.StartsWith('#'))) {
        Write-Warning "No type specified in the first line of docker-compose.yml."
        exit 1
    }

    $type = $firstLine.TrimStart('#').Trim()
    $yaml = ConvertFrom-Yaml (Get-Content $composeFile -Raw) -Ordered
    if (-not $yaml.services) {
        Write-Error "No 'services' section found in docker-compose.yml"
        exit 1
    }

     if ($type -eq "direct") {
        $ports = @()
        foreach ($service in $yaml.services.Values) {
            if (-not $service.ports) { 
                continue 
            }
            foreach ($port in $service.ports) {
                if ($port.Trim() -match '(\d+):\d+$') {
                    $ports += $matches[1]
                }
            }
        }
        return @{ ports = $ports }
    }

    $portInfo = $null
    foreach ($service in $yaml.services.Values) {
        if (-not $service.ports) { 
            continue 
        }
        foreach ($port in $service.ports) {
            # Trim whitespace and match "hostPort:containerPort" or "ip:hostPort:containerPort"
            if ($port.Trim() -match '(\d+):\d+$') {
                $portInfo = @{
                    port = $matches[1]
                    type = $type
                }
                break
            }
        }
        if ($portInfo) { 
            break 
        }
    }

    return $portInfo
}

if (-not [System.Environment]::GetEnvironmentVariable("NGINX_HOME")) {
    Write-Error "Environment variable 'NGINX_HOME' is not set."
    exit 1
}

$firstPortInfo = Get-PortInfo

if (-not $firstPortInfo) {
    Write-Error "Could not find a host port in docker-compose.yml"
    exit 0
}

Write-Host "First host port found: $($firstPortInfo.port) of type '$($firstPortInfo.type)'"

# Step 1: Generate NGINX configuration
function Invoke-ToolScript {
    param(
        [string]$ScriptPath,
        [Parameter(ValueFromRemainingArguments = $true)]
        $Arguments
    )
    $proc = Start-Process -FilePath "pwsh" -ArgumentList @("-File"; $ScriptPath; $Arguments) -Wait -PassThru -NoNewWindow -RedirectStandardOutput "stdout.log" -RedirectStandardError "stderr.log"
    $exitCode = $proc.ExitCode
    if ($exitCode -ne 0) {
        Write-Host "$ScriptPath $Arguments failed with exit code $exitCode."
        Write-Host "---- stdout.log ----"
        Get-Content "stdout.log" | Write-Host
        Write-Host "---- stderr.log ----"
        Get-Content "stderr.log" | Write-Host
        exit $exitCode
    }
    Write-Host "$ScriptPath $Arguments executed successfully."
    Write-Host "---- stdout.log ----"
    Get-Content "stdout.log" | Write-Host
    Write-Host "---- stderr.log ----"
    Get-Content "stderr.log" | Write-Host
    Remove-Item "stdout.log","stderr.log" -ErrorAction SilentlyContinue
}

if ($firstPortInfo.type -ne 'http' -and $firstPortInfo.type -ne 'matrix') {
    Write-Host "Port type is not 'http' or 'matrix'; skipping HTTPS configuration."
    Write-Host "Deployment completed successfully."
    exit 0
}

# Step 1: Generate NGINX configuration
Invoke-ToolScript "../workflow/tools/New-NginxConfig.ps1" -data $firstPortInfo

# Step 2: Try to apply NGINX configuration
Invoke-ToolScript "../workflow/tools/Update-NginxConfig.ps1" -data $firstPortInfo

if ($firstPortInfo.type -ne 'http' -and $firstPortInfo.type -ne 'matrix') {
    Write-Host "Port type is not 'http' or 'matrix'; skipping HTTPS configuration."
    Write-Host "Deployment completed successfully."
    exit 0
}

if (-not [System.Environment]::GetEnvironmentVariable("CERT_HOME")) {
    Write-Error "Environment variable 'CERT_HOME' is not set."
    exit 1
}

$secondConfig = $firstPortInfo.type + '_ssl'

# Step 3: Generate SSL certificates
Invoke-ToolScript "../workflow/tools/New-Certificate.ps1"

# Step 4: Generate HTTP+HTTPS NGINX configuration
Invoke-ToolScript "../workflow/tools/New-NginxConfig.ps1" -type $secondConfig -port $firstPortInfo.port

# Step 5: Try to apply HTTP+HTTPS NGINX configuration
Invoke-ToolScript "../workflow/tools/Update-NginxConfig.ps1" -type $secondConfig

Write-Host "Deployment completed successfully."