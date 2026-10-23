<#
.SYNOPSIS
Runs cleanse-app in Docker the way CDP runs it, against a local or a deployed Cleanse backend.

.DESCRIPTION
Builds the production image and starts compose.yml: NODE_ENV=production, ECS JSON logs and
sessions in an encrypted cookie. Waits until the container is healthy, then checks the home page
and reads the status page back.

For live reload while you work on the code, use ./dev-up.ps1, which runs on Node instead.

Host port 3000 can be moved with the CLEANSE_APP_PORT environment variable.

.PARAMETER Backend
local  The backend's own Docker stack (../cleanse, ./dev-docker-up.ps1), which must be running:
       this stack joins its network and reaches the backend as http://cleanse:8085. The default.
dev    cleanse in CDP's dev environment, through CDP's developer ephemeral gateway. Needs the User
       environment variables CDP_EPHEMERAL_GW_KEY (your developer key for dev, from your user
       profile in the CDP Portal; it lasts 24 hours) and CLEANSE_APIKEY (cleanse's
       Auth__ApiKey__Key secret for dev). Changes you make are made to dev's data.

.PARAMETER NoBuild
Reuse the last image instead of rebuilding it.

.PARAMETER Follow
Follow the app's logs once it is up. Ctrl+C stops following; the stack keeps running.

.PARAMETER Down
Stop the stack and exit.

.PARAMETER SkipSmoke
Skip the HTTP checks made once the stack reports healthy.

.EXAMPLE
./dev-docker-up.ps1

.EXAMPLE
./dev-docker-up.ps1 -Backend dev

.EXAMPLE
./dev-docker-up.ps1 -Down
#>
[CmdletBinding()]
param(
  [ValidateSet('local', 'dev')]
  [string]$Backend = 'local',

  [switch]$NoBuild,
  [switch]$Follow,
  [switch]$Down,
  [switch]$SkipSmoke
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'scripts\backend-target.ps1')

# Matches `name:` in compose.yml. Passed explicitly so COMPOSE_PROJECT_NAME cannot redirect it.
$project = 'cleanse-app'
# Created by the backend's stack, in ../cleanse; see compose.local-backend.yml.
$backendNetwork = 'cleanse_cdp-tenant'

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

# Windows PowerShell turns a native command's redirected stderr into terminating errors under
# ErrorActionPreference=Stop; the exit code is the signal that matters, so read that instead.
function Invoke-Native([scriptblock]$Command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command } finally { $ErrorActionPreference = $previous }
}

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'The docker CLI was not found. Install Docker Desktop (or another Docker engine) and try again.'
  }

  $server = Invoke-Native { docker version --format '{{.Server.Version}}' 2>$null }
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace("$server")) {
    throw 'Docker is installed but the engine is not reachable. Start Docker Desktop and try again.'
  }

  $compose = Invoke-Native { docker compose version --short 2>$null }
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose v2 (the "docker compose" plugin) is required.'
  }

  Write-Host "    Docker engine $server, Compose $compose"
}

function Get-AppPort {
  $value = [Environment]::GetEnvironmentVariable('CLEANSE_APP_PORT')
  if ([string]::IsNullOrWhiteSpace($value)) {
    return 3000
  }

  $port = 0
  if (-not [int]::TryParse($value, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw "CLEANSE_APP_PORT must be a port number between 1 and 65535; found '$value'."
  }

  return $port
}

# Fails before anything starts, rather than part-way through. A connection attempt is the test,
# because the Windows listener table can briefly omit a listener that is accepting connections.
function Assert-PortFree([int]$Port) {
  $holders = @(Invoke-Native { docker ps --filter "publish=$Port" --format '{{.Names}}' } | Where-Object { $_ })
  $ours = @(Invoke-Native { docker ps --filter "label=com.docker.compose.project=$project" --filter "publish=$Port" --format '{{.Names}}' } | Where-Object { $_ })
  $theirs = @($holders | Where-Object { $ours -notcontains $_ })

  if ($theirs.Count -gt 0) {
    throw "Port $Port is published by the container(s) $($theirs -join ', '). Stop them, or set CLEANSE_APP_PORT to another port."
  }

  if ($ours.Count -gt 0) {
    return
  }

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    if ($client.ConnectAsync('127.0.0.1', $Port).Wait(750)) {
      throw "Port $Port is in use, perhaps by ./dev-up.ps1. Stop it, or set CLEANSE_APP_PORT to another port."
    }
  }
  catch [System.AggregateException] {
    # Refused: nothing is listening.
  }
  finally {
    $client.Dispose()
  }
}

function Show-Failure {
  Write-Host ''
  Write-Host 'cleanse-app did not come up healthy. Current state and logs:' -ForegroundColor Red
  & docker compose --project-name $project @composeFiles ps --all
  & docker compose --project-name $project @composeFiles logs --no-color --tail 40 cleanse-app
}

# The status page, read back as text: the summary tag and a line per check.
function Test-App([int]$Port) {
  Write-Step 'Checking the app'
  $base = "http://localhost:$Port"

  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "$base/health" -TimeoutSec 10
    Write-Host "    GET /health          $($health.StatusCode)"
    $homePage = Invoke-WebRequest -UseBasicParsing -Uri "$base/" -TimeoutSec 60
    Write-Host "    GET /                $($homePage.StatusCode)"
    $status = Invoke-WebRequest -UseBasicParsing -Uri "$base/admin/status" -TimeoutSec 60
  }
  catch {
    throw "The app did not answer as expected: $($_.Exception.Message) See: docker compose --project-name $project logs cleanse-app"
  }

  $html = [string]$status.Content
  $summary = [regex]::Match($html, '<strong class="govuk-tag[^"]*">\s*([^<]+?)\s*</strong>').Groups[1].Value
  Write-Host "    GET /admin/status    $($status.StatusCode): $summary"

  $rows = [regex]::Matches($html, '(?s)aria-label="([^"]+)">[^<]*</span>\s*</td>\s*<th scope="row" class="govuk-table__header">([^<]+)</th>\s*<td class="govuk-table__cell app-status__detail">(.*?)</td>')
  foreach ($row in $rows) {
    $detail = ($row.Groups[3].Value -replace '<[^>]+>', ' ' -replace '\s+', ' ').Trim()
    $detail = [System.Net.WebUtility]::HtmlDecode($detail)
    Write-Host ('      {0,-8} {1,-16} {2}' -f $row.Groups[1].Value, $row.Groups[2].Value.Trim(), $detail)
  }
}

# The app logs ECS JSON for OpenSearch; this keeps the time, level and message.
function Format-LogLine([string]$Line) {
  if (-not $Line.StartsWith('{')) {
    return $Line
  }

  try {
    $entry = $Line | ConvertFrom-Json
  }
  catch {
    return $Line
  }

  $time = ''
  if ($entry.'@timestamp') {
    $time = ([DateTimeOffset]$entry.'@timestamp').ToLocalTime().ToString('HH:mm:ss')
  }

  $text = '{0} {1,-5} {2}' -f $time, $entry.'log.level', $entry.message
  if ($entry.error -and $entry.error.message) {
    $text += " | $($entry.error.type): $($entry.error.message)"
  }

  return $text
}

$previousBackend = $null
Push-Location $PSScriptRoot

try {
  $port = Get-AppPort
  $composeFiles = @('--file', 'compose.yml')

  Write-Step 'Checking Docker'
  Assert-Docker

  if ($Down) {
    Write-Step 'Stopping the cleanse-app stack'
    & docker compose --project-name $project @composeFiles down --remove-orphans
    if ($LASTEXITCODE -ne 0) {
      throw 'docker compose down failed; see the output above.'
    }

    Write-Host 'Stopped.' -ForegroundColor Green
    return
  }

  Write-Step "Checking the $Backend backend"
  if ($Backend -eq 'local') {
    Invoke-Native { docker network inspect $backendNetwork 2>$null } | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "The backend stack is not running, so its network '$backendNetwork' does not exist. Start it first with ../cleanse/dev-docker-up.ps1, or use -Backend dev."
    }

    $target = Get-CleanseBackendTarget 'local' -LocalUrl 'http://cleanse:8085'
    Test-CleanseBackendTarget $target -ProbeUrl 'http://localhost:8085'
    $composeFiles += @('--file', 'compose.local-backend.yml')
  }
  else {
    $target = Get-CleanseBackendTarget 'dev'
    Test-CleanseBackendTarget $target
  }

  Write-Host "    $($target.Description)"
  Assert-PortFree $port

  # Read by compose.yml while it is interpolated, and restored afterwards.
  $previousBackend = Set-CleanseBackendVariables $target

  $upArgs = @('up', '--detach', '--wait', '--wait-timeout', '180', '--remove-orphans')
  if ($NoBuild) {
    Write-Step 'Starting cleanse-app (no rebuild)'
  }
  else {
    Write-Step 'Building the image and starting cleanse-app'
    $upArgs += '--build'
  }

  & docker compose --project-name $project @composeFiles @upArgs
  if ($LASTEXITCODE -ne 0) {
    Show-Failure
    throw 'cleanse-app did not come up healthy; see the state and logs above.'
  }

  if (-not $SkipSmoke) {
    Test-App $port
  }

  Write-Host ''
  Write-Host 'cleanse-app is up, in production mode.' -ForegroundColor Green
  Write-Host "  App         http://localhost:$port"
  Write-Host "  Status      http://localhost:$port/admin/status"
  Write-Host "  Backend     $($target.Description)"
  Write-Host "              $($target.Url)"
  if ($target.Name -eq 'dev') {
    Write-Host '              Changes you make here are made to the dev environment''s data.' -ForegroundColor Yellow
  }
  Write-Host "  Logs        docker compose --project-name $project logs -f cleanse-app   (or ./dev-docker-up.ps1 -NoBuild -Follow)"
  Write-Host '  Stop        ./dev-docker-up.ps1 -Down'

  if ($Follow) {
    Write-Step 'Following the app''s logs (Ctrl+C stops following; the stack keeps running)'
    & docker compose --project-name $project @composeFiles logs --follow --no-log-prefix --tail 20 cleanse-app |
      ForEach-Object { Format-LogLine $_ }
  }
}
finally {
  if ($previousBackend) {
    Restore-CleanseBackendVariables $previousBackend
  }

  Pop-Location
}
