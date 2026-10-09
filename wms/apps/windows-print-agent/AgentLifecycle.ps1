# FIX: explicit interactive user, stable installation and a single station process.
$script:AgentVersion = '2026.10.09.1'
$script:AgentTaskName = 'LOGOFF FBS Print Agent'
function Get-AgentHome { return Join-Path $env:LOCALAPPDATA 'LOGOFF\PrintAgent' }
function Assert-AgentInteractiveUser {
  # An elevated session under another account must not install into that admin's profile.
  $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $shells = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe' AND SessionId=$session")
  if (-not $shells.Count) { throw 'Run setup on the printing Windows desktop, not from a background/remote service session.' }
  foreach ($shell in $shells) {
    $owner = Invoke-CimMethod -InputObject $shell -MethodName GetOwnerSid
    if ($owner.ReturnValue -eq 0 -and $owner.Sid -eq $sid) { return }
  }
  throw 'Setup is running as another Windows user. Run it from the printer operator account; elevation is allowed only for that same account.'
}
function Get-SavedAgentConfig([string]$packageRoot) {
  $paths = @((Join-Path (Get-AgentHome) 'config.json'))
  $task = Get-ScheduledTask -TaskName $script:AgentTaskName -ErrorAction SilentlyContinue
  if ($task) {
    foreach ($action in $task.Actions) {
      if ($action.Arguments -match '(?i)-File\s+"([^"]+LOGOFF-FBS-Print-Agent\.ps1)"') {
        $paths += Join-Path (Split-Path -Parent $Matches[1]) 'config.json'
      }
    }
  }
  $paths += Join-Path $packageRoot 'config.json'
  foreach ($path in $paths | Select-Object -Unique) {
    if (Test-Path -LiteralPath $path) {
      $cfg = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
      if (-not $cfg.stationId -or -not $cfg.server -or -not $cfg.printerName) { throw "Invalid saved configuration: $path. Repair it instead of registering another station." }
      return $cfg
    }
  }
  return $null
}
function Register-AgentTask([string]$agentHome) {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $agentHome 'LOGOFF-FBS-Print-Agent.ps1')`"" -WorkingDirectory $agentHome
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $script:AgentTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}
function Install-AgentFiles([string]$packageRoot, $cfg) {
  $agentHome = Get-AgentHome
  [IO.Directory]::CreateDirectory($agentHome) | Out-Null
  $task = Get-ScheduledTask -TaskName $script:AgentTaskName -ErrorAction SilentlyContinue
  $files = @('LOGOFF-FBS-Print-Agent.ps1','WmsApi.ps1','PrintSeries.ps1','JobJournal.ps1','AgentLifecycle.ps1','Setup-Agent.ps1','Install-Agent.cmd','README.txt')
  $unchanged = $true
  foreach ($name in $files) {
    $source = Join-Path $packageRoot $name
    $target = Join-Path $agentHome $name
    if (-not (Test-Path -LiteralPath $target) -or (Get-AgentHash ([IO.File]::ReadAllText($source))) -ne (Get-AgentHash ([IO.File]::ReadAllText($target)))) { $unchanged = $false; break }
  }
  $configFile = Join-Path $agentHome 'config.json'
  $sameConfig = (Test-Path -LiteralPath $configFile) -and ((Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json | ConvertTo-Json -Compress) -eq ($cfg | ConvertTo-Json -Compress))
  if ($unchanged -and $sameConfig -and $task -and $task.Actions[0].Arguments.Contains((Join-Path $agentHome 'LOGOFF-FBS-Print-Agent.ps1'))) {
    if (Test-Path -LiteralPath (Join-Path $agentHome 'stop.request')) { Remove-Item -LiteralPath (Join-Path $agentHome 'stop.request') }
    if ($task.State -notin @('Running','Queued')) { Start-ScheduledTask -TaskName $script:AgentTaskName }
    return $agentHome
  }
  if ($task -and $task.State -in @('Running','Queued')) {
    # Do not terminate a job in the spooler. New versions stop at a cycle boundary.
    $actionPath = $null
    foreach ($action in $task.Actions) { if ($action.Arguments -match '(?i)-File\s+"([^"]+LOGOFF-FBS-Print-Agent\.ps1)"') { $actionPath = $Matches[1] } }
    if (-not $actionPath -or -not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $actionPath) 'AgentLifecycle.ps1'))) {
      throw 'The previous agent is running. Finish printing, stop LOGOFF FBS Print Agent in Task Scheduler, then run this installer again. The saved station will be retained.'
    }
    [IO.File]::WriteAllText((Join-Path (Split-Path -Parent $actionPath) 'stop.request'), 'update')
    for ($i=0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 500
      $task = Get-ScheduledTask -TaskName $script:AgentTaskName -ErrorAction SilentlyContinue
      if (-not $task -or $task.State -notin @('Running','Queued')) { break }
    }
    if ($task -and $task.State -in @('Running','Queued')) { throw 'Agent is still finishing a job. Wait, then retry the update.' }
  }
  foreach ($name in $files) {
    $source = [IO.Path]::GetFullPath((Join-Path $packageRoot $name))
    $target = [IO.Path]::GetFullPath((Join-Path $agentHome $name))
    if ($source -ne $target) { Copy-Item -LiteralPath $source -Destination $target -Force }
  }
  Write-AtomicJson (Join-Path $agentHome 'config.json') $cfg
  # The old process status must not be mistaken for the newly started version.
  $statusFile = Join-Path $agentHome 'status.json'
  if (Test-Path -LiteralPath $statusFile) { Remove-Item -LiteralPath $statusFile }
  $stop = Join-Path $agentHome 'stop.request'
  if (Test-Path -LiteralPath $stop) { Remove-Item -LiteralPath $stop }
  Register-AgentTask $agentHome
  Start-ScheduledTask -TaskName $script:AgentTaskName
  return $agentHome
}
function Enter-AgentMutex($cfg) {
  $name = 'Global\LOGOFF.PrintAgent.' + (Get-AgentHash "$($cfg.server.TrimEnd('/'))|$($cfg.stationId)")
  $script:agentMutex = [Threading.Mutex]::new($false, $name)
  try { $script:ownsAgentMutex = $script:agentMutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $script:ownsAgentMutex = $true }
  return $script:ownsAgentMutex
}
function Write-AgentState([string]$stage, [string]$errorText = '') {
  try {
    $now = [DateTime]::UtcNow
    if ($stage -eq $script:lastStage -and $errorText -eq $script:lastStateError -and ($now-$script:lastStateAt).TotalSeconds -lt 30) { return }
    Write-AtomicJson (Join-Path $PSScriptRoot 'status.json') @{version=$script:AgentVersion;pid=$PID;startedAt=$script:agentStartedAt;updatedAt=$now.ToString('o');stage=$stage;error=$errorText;windowsUser=[Security.Principal.WindowsIdentity]::GetCurrent().Name}
    $script:lastStage=$stage; $script:lastStateError=$errorText; $script:lastStateAt=$now
  } catch { Write-AgentError 'diagnostics' $_ }
}
