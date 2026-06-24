$ErrorActionPreference = 'Stop'

$taskName = 'gpt-stt-local-server'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$startScript = Join-Path $PSScriptRoot 'start-local-server.ps1'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Start script not found: $startScript"
}

$actionArgs = @(
  '-NoLogo',
  '-NoExit',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  "`"$startScript`"",
  '-ProjectDir',
  "`"$projectDir`"",
  '-Port',
  '3010'
) -join ' '

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$trigger.Delay = 'PT15S'
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Open a visible terminal and start the gpt-stt local Next.js server at user logon.' `
  -Force | Out-Null

Write-Host "Registered scheduled task: $taskName"
Write-Host "It will open a PowerShell terminal and run npm run dev after you log in."
Write-Host "Project: $projectDir"
