# FIX: separate one-label queue. Never feed these jobs into the WB two-label path.
function Invoke-KizDuplicateCycle($cfg) {
  if ($cfg.labelWidthMm -ne 58 -or $cfg.labelHeightMm -ne 40) { return }
  $base = "/print/kiz-duplicates/stations/$($cfg.stationId)"
  Invoke-WmsApi Post "$base/heartbeat" @{} | Out-Null
  $duplicate = Invoke-WmsApi Post "$base/claim" @{}
  if (-not $duplicate) { return }
  $result = @{ success = $false }
  try {
    if ($duplicate.contentType -ne 'image/png' -or $duplicate.widthMm -ne 58 -or $duplicate.heightMm -ne 40) { throw 'Invalid duplicate label format.' }
    $bytes = [Convert]::FromBase64String($duplicate.imageBase64)
    if ($bytes.Length -lt 8 -or [BitConverter]::ToString($bytes, 0, 8) -ne '89-50-4E-47-0D-0A-1A-0A') { throw 'Invalid duplicate PNG.' }
    Print-OneLabel $bytes $cfg.printerName 58 40
    $result.success = $true
  } catch { $result.error = $_.Exception.Message }
  # FIX: retry only the acknowledgement; never print again after an HTTP timeout.
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    try { Invoke-WmsApi Post "$base/jobs/$($duplicate.id)/result" $result | Out-Null; return }
    catch { if ($attempt -eq 1) { throw } }
  }
}
