$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

Write-Host 'Starting Cleanse frontend at http://localhost:3000'
npm.cmd run dev
