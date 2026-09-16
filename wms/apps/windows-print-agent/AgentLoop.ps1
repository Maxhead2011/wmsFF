# FIX: fast polling is limited to our WMS; other installations keep their timing.
function Test-WmsFastPolling($cfg) {
  try { return ([Uri]$cfg.server).DnsSafeHost -eq 'wms.logoff.pro' } catch { return $false }
}

function Get-WmsPollDelay([bool]$hadJob, [bool]$hadError, [bool]$fastPolling) {
  if (-not $fastPolling -or $hadError) { return 2000 }
  if ($hadJob) { return 0 }
  return 250
}

function Invoke-WmsFbsPrintCycle($cfg, [bool]$fastPolling) {
  # claim already records lastSeenAt on the server. Do not put another round trip before it.
  if (-not $fastPolling) {
    Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/heartbeat" @{} | Out-Null
  }
  $job = Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/claim" @{}
  if (-not $job) { return $false }
  try {
    if (-not $job.sortingLabel.imageBase64 -or $job.sortingLabel.contentType -ne 'image/png') { throw 'Update the WMS server: sorting label is unavailable.' }
    Print-OneLabel ([Convert]::FromBase64String($job.stickerBase64)) $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
    Print-SortingLabel $job $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
    Invoke-WmsApi Post "/marketplace-connections/fbs/print-jobs/$($job.id)/result" @{ success = $true } | Out-Null
  } catch {
    Invoke-WmsApi Post "/marketplace-connections/fbs/print-jobs/$($job.id)/result" @{ success = $false; error = $_.Exception.Message } | Out-Null
  }
  return $true
}
