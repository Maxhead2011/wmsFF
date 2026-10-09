# FIX: durable, station-scoped outcomes; never resubmit uncertain physical jobs.
function Get-AgentHash([string]$value) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose() }
}
function Write-AtomicJson([string]$path, $value) {
  $temporary = $path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  $bytes = [Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 10 -Compress))
  try {
    $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if ([IO.File]::Exists($path)) { [IO.File]::Replace($temporary, $path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $path) }
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function Initialize-PrintJournal($cfg, [string]$root) {
  $scope = Get-AgentHash "$($cfg.server.TrimEnd('/'))|$($cfg.stationId)"
  $script:journalDirectory = Join-Path $root $scope
  [IO.Directory]::CreateDirectory($script:journalDirectory) | Out-Null
  $script:printRecords = @{}
  $script:pendingPrintRecords = @{}
  $script:conflictRetryAt = @{}
  foreach ($file in Get-ChildItem -LiteralPath $script:journalDirectory -Filter '*.json') {
    $record = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $record.id -or $record.queue -notin @('fbs','label','series') -or $record.state -notin @('started','result','acknowledged') -or -not $record.path) { throw 'Invalid print journal. Contact support; do not delete it or reprint blindly.' }
    $script:printRecords["$($record.queue)|$($record.id)"] = $record
    if ($record.state -ne 'acknowledged') { $script:pendingPrintRecords["$($record.queue)|$($record.id)"] = $record }
  }
}
function Save-PrintRecord([string]$queue, [string]$id, $record) {
  $key = "$queue|$id"
  $value = @{queue=$queue;id=$id;state=$record.state;path=$record.path;result=$record.result;updatedAt=[DateTime]::UtcNow.ToString('o')}
  Write-AtomicJson (Join-Path $script:journalDirectory ((Get-AgentHash $key) + '.json')) $value
  $script:printRecords[$key] = [pscustomobject]$value
  if ($value.state -eq 'acknowledged') { $script:pendingPrintRecords.Remove($key) }
  else { $script:pendingPrintRecords[$key] = [pscustomobject]$value }
}
function Send-PrintResult([string]$queue, [string]$id) {
  $key = "$queue|$id"
  if ($script:conflictRetryAt.ContainsKey($key) -and [DateTime]::UtcNow -lt $script:conflictRetryAt[$key]) { return }
  $record = $script:printRecords[$key]
  if ($record.state -eq 'started') {
    Save-PrintRecord $queue $id @{state='result';path=$record.path;result=@{success=$false;error='Printing interrupted; verify physical labels before reprinting.'}}
    $record = $script:printRecords["$queue|$id"]
  }
  # HTTP exceptions never replace a successful print outcome with failure.
  # FIX: a business conflict retains the durable outcome without starving other jobs.
  try { Invoke-WmsApi Post $record.path $record.result | Out-Null }
  catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) {
      $script:conflictRetryAt[$key] = [DateTime]::UtcNow.AddMinutes(1)
      if (Get-Command Write-AgentError -ErrorAction SilentlyContinue) { Write-AgentError "ack-conflict:$queue`:$id" $_ }
      return
    }
    throw
  }
  $script:conflictRetryAt.Remove($key)
  if ($record.state -ne 'acknowledged') { Save-PrintRecord $queue $id @{state='acknowledged';path=$record.path;result=$record.result} }
}
function Sync-PrintResults([string]$queue) {
  foreach ($record in @($script:pendingPrintRecords.Values)) {
    if ($record.queue -eq $queue -and $record.state -ne 'acknowledged') { Send-PrintResult $queue $record.id }
  }
}
function Invoke-DurablePrint($cfg, [string]$queue, [string]$id, [scriptblock]$print) {
  if (-not $id) { throw 'Missing print job identifier.' }
  if ($script:printRecords.ContainsKey("$queue|$id")) { Send-PrintResult $queue $id; return }
  $escaped = [Uri]::EscapeDataString($id)
  $path = switch ($queue) {
    'fbs' { "/marketplace-connections/fbs/print-jobs/$escaped/result" }
    'label' { "/print/agent-jobs/$escaped/result" }
    'series' { "/print/series/stations/$($cfg.stationId)/jobs/$escaped/result" }
    default { throw 'Unknown print queue.' }
  }
  Save-PrintRecord $queue $id @{state='started';path=$path;result=$null}
  $result = @{success=$true}
  try { & $print | Out-Null }
  catch { $result = @{success=$false;error=('Print failed or interrupted; verify physical labels before reprinting. ' + $_.Exception.Message)} }
  Save-PrintRecord $queue $id @{state='result';path=$path;result=$result}
  Send-PrintResult $queue $id
}
