# FIX: one Windows spool document for the entire series, with all images checked first.
function New-SeriesPrintDocument { return [Drawing.Printing.PrintDocument]::new() }
function Print-LabelSeries($job, [string]$printer) {
  if (-not $job.pages -or $job.pages.Count -gt 500) { throw 'Invalid print series.' }
  $images = [Collections.Generic.List[Drawing.Image]]::new()
  $streams = [Collections.Generic.List[IO.MemoryStream]]::new()
  $doc = $null
  try {
    $pixels = 0L
    foreach ($page in $job.pages) {
      $stream = [IO.MemoryStream]::new([Convert]::FromBase64String($page.imageBase64))
      $streams.Add($stream)
      $img = [Drawing.Image]::FromStream($stream, $true, $true)
      $images.Add($img)
      $pixels += [long]$img.Width * $img.Height
      if ($pixels -gt 60000000 -or [Math]::Abs($img.Width / $img.Height - $job.widthMm / $job.heightMm) -gt 0.08) { throw 'Invalid series image dimensions.' }
    }
    $doc = New-SeriesPrintDocument
    $doc.DocumentName = 'LOGOFF ' + $job.id
    $doc.PrinterSettings.PrinterName = $printer
    if (-not $doc.PrinterSettings.IsValid) { throw 'Printer is unavailable.' }
    $doc.PrinterSettings.Copies = 1
    $doc.PrintController = [Drawing.Printing.StandardPrintController]::new()
    $doc.OriginAtMargins = $false
    $width = [int][Math]::Round($job.widthMm / 25.4 * 100)
    $height = [int][Math]::Round($job.heightMm / 25.4 * 100)
    $paper = [Drawing.Printing.PaperSize]::new('LOGOFF_SERIES', $width, $height)
    $paper.RawKind = 256
    $doc.DefaultPageSettings.PaperSize = $paper
    $doc.DefaultPageSettings.Landscape = $false
    $doc.DefaultPageSettings.Margins = [Drawing.Printing.Margins]::new(0,0,0,0)
    $state = @{ Index = 0 }
    $handler = [Drawing.Printing.PrintPageEventHandler]{ param($sender,$e)
      $e.Graphics.PageUnit = [Drawing.GraphicsUnit]::Display
      $e.Graphics.DrawImage($images[$state.Index], [Drawing.RectangleF]::new(0,0,$width,$height))
      $state.Index++
      $e.HasMorePages = $state.Index -lt $images.Count
    }
    $doc.add_PrintPage($handler)
    try { $doc.Print() } finally { $doc.remove_PrintPage($handler) }
  } finally {
    if ($doc) { $doc.Dispose() }
    foreach ($img in $images) { $img.Dispose() }
    foreach ($stream in $streams) { $stream.Dispose() }
  }
}

function Invoke-PrintSeriesCycle($cfg) {
  $prefix = "/print/series/stations/$($cfg.stationId)"
  Invoke-WmsApi Post "$prefix/heartbeat" @{} | Out-Null
  # FIX: retry only the acknowledgement after a network failure, never the physical print.
  if ($script:seriesResult) {
    Invoke-WmsApi Post "$prefix/jobs/$($script:seriesResult.id)/result" $script:seriesResult.result | Out-Null
    $script:seriesResult = $null
  }
  $job = Invoke-WmsApi Post "$prefix/claim" @{}
  if (-not $job) { return $false }
  $result = @{ success = $false; error = 'Printing interrupted; verify physical labels before reprinting.' }
  try { Print-LabelSeries $job $cfg.printerName; $result = @{ success = $true } }
  catch { $result.error = $_.Exception.Message }
  $script:seriesResult = @{ id = $job.id; result = $result }
  Invoke-WmsApi Post "$prefix/jobs/$($job.id)/result" $result | Out-Null
  $script:seriesResult = $null
  return $true
}
