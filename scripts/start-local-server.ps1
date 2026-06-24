param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [int]$Port = 3010
)

$ErrorActionPreference = 'Stop'

function Write-Info($Message) {
  Write-Host "[gpt-stt] $Message"
}

Set-Location -LiteralPath $ProjectDir
Write-Info "Project: $ProjectDir"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
  Write-Host "[gpt-stt] npm was not found in PATH." -ForegroundColor Red
  Write-Host "Install Node.js, then open this script again."
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir 'node_modules'))) {
  Write-Host "[gpt-stt] node_modules is missing." -ForegroundColor Yellow
  Write-Host "Run npm install once in this project, then restart this task."
  Read-Host "Press Enter to close"
  exit 1
}

$connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Listen' } |
  Select-Object -First 1

if ($connection) {
  Write-Host "[gpt-stt] Port $Port is already in use by process $($connection.OwningProcess)." -ForegroundColor Yellow
  Write-Host "If the server is already open, use http://localhost:$Port"
  Read-Host "Press Enter to close"
  exit 0
}

Write-Info "Starting local server on http://localhost:$Port"
Write-Info "Keep this terminal open. Press Ctrl+C to stop."
npm run dev
