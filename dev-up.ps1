[CmdletBinding()]
param(
  # Anonymise all backend data shown in the UI (see README "Demo anonymisation").
  [switch]$Demo
)

$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

$previousAnonymise = $env:DEMO_ANONYMISE
$previousKey = $env:DEMO_ANONYMISE_KEY

try {
  if ($Demo) {
    # Stable per-machine key, so fakes stay consistent across restarts on this machine.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("cleanse-demo:$([Environment]::MachineName)")
      $hash = $sha.ComputeHash($bytes)
    } finally {
      $sha.Dispose()
    }

    $env:DEMO_ANONYMISE = 'true'
    $env:DEMO_ANONYMISE_KEY = [System.BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()

    Write-Host 'Demo mode: backend data will be anonymised.' -ForegroundColor Yellow
    Write-Host 'Actions taken during the demo still change real issues.' -ForegroundColor Yellow
  } else {
    Remove-Item Env:DEMO_ANONYMISE -ErrorAction SilentlyContinue
    Remove-Item Env:DEMO_ANONYMISE_KEY -ErrorAction SilentlyContinue
  }

  Write-Host 'Starting Cleanse frontend at http://localhost:3000'
  npm.cmd run dev
} finally {
  # $env: changes persist in the calling PowerShell session, so restore them.
  $env:DEMO_ANONYMISE = $previousAnonymise
  $env:DEMO_ANONYMISE_KEY = $previousKey
}
