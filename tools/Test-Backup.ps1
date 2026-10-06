$ErrorActionPreference = 'Stop'

$workflowPath = Join-Path $PSScriptRoot '../.github/workflows/template-backup.yml'
$workflow = Get-Content -Raw $workflowPath
$match = [regex]::Match($workflow, '(?ms)^          Write-Host "Checking for volumes and mounts.*?(?=^        shell: pwsh)')
if (-not $match.Success) {
    throw 'Backup step not found'
}
$backupScript = [scriptblock]::Create(($match.Value -replace '(?m)^          ', ''))

$env:PROJECT_NAME = 'fah-break'
$env:RESTIC_ROOT = 'C:\Backup'
$env:COMPUTERNAME = 'test-runner'
$env:INPUT_TAGS = ''
$script:dockerCalls = [System.Collections.Generic.List[object]]::new()
$script:resticCalls = [System.Collections.Generic.List[object]]::new()

function docker {
    $Arguments = @($args)
    $global:LASTEXITCODE = 0
    if ($Arguments[0] -eq 'compose') {
        if (($Arguments -join ' ') -ne 'compose config --format json') {
            throw "Unexpected Compose invocation: $Arguments"
        }
        return $script:config | ConvertTo-Json -Depth 20
    }
    $script:dockerCalls.Add($Arguments)
}

function restic {
    $Arguments = @($args)
    $global:LASTEXITCODE = 0
    $script:resticCalls.Add($Arguments)
}

function Assert-Equal {
    param($Actual, $Expected)
    if ($Actual -cne $Expected) {
        throw "Expected '$Expected', got '$Actual'"
    }
}

$script:config = @{
    services = @{ app = @{ volumes = @(
        @{ type = 'bind'; source = 'C:\nginx home\logs' }
    ) } }
}
& $backupScript
Assert-Equal $script:dockerCalls.Count 0
Assert-Equal $script:resticCalls.Count 1
Assert-Equal $script:resticCalls[0][1] 'C:\nginx home\logs'
Write-Host 'PASS: bind-only service backs up the resolved Windows path with spaces'

$script:dockerCalls.Clear()
$script:resticCalls.Clear()
$script:config = @{
    services = @{
        app = @{ volumes = @(
            @{ type = 'volume'; source = 'data.with-dots' },
            @{ type = 'volume'; source = 'webdav' },
            @{ type = 'volume'; target = '/anonymous' },
            @{ type = 'bind'; source = 'C:\nginx home\logs' },
            @{ type = 'bind'; source = '/var/run/docker.sock' }
        ) }
        worker = @{ volumes = @(
            @{ type = 'volume'; source = 'data.with-dots' },
            @{ type = 'bind'; source = 'C:\nginx home\logs' }
        ) }
        empty = @{}
    }
    volumes = @{
        'data.with-dots' = @{}
        webdav = @{ driver = 'fentas/davfs' }
    }
}
& $backupScript
Assert-Equal $script:dockerCalls.Count 1
Assert-Equal ($script:dockerCalls[0] -contains 'fah-break_data.with-dots:/data.with-dots:ro') $true
Assert-Equal $script:resticCalls.Count 1
Assert-Equal $script:resticCalls[0][1] 'C:\nginx home\logs'
Write-Host 'PASS: named volumes, driver exclusions, deduplication, anonymous volumes and socket exclusions'

$script:dockerCalls.Clear()
$script:resticCalls.Clear()
$script:config = @{ services = @{ app = @{} } }
& $backupScript
Assert-Equal $script:dockerCalls.Count 0
Assert-Equal $script:resticCalls.Count 0
Write-Host 'PASS: services without mounts do not invoke backup commands'