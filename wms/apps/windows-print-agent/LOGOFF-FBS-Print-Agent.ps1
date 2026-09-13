param([string]$ConfigPath = "$PSScriptRoot\config.json")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

. (Join-Path $PSScriptRoot 'WmsApi.ps1')

function Print-OneLabel([byte[]]$bytes, [string]$printer, [int]$widthMm, [int]$heightMm) {
  $stream = [IO.MemoryStream]::new($bytes)
  $image = [Drawing.Image]::FromStream($stream)
  $doc = [Drawing.Printing.PrintDocument]::new()
  $paperWidth = [int][Math]::Round($widthMm / 25.4 * 100)
  $paperHeight = [int][Math]::Round($heightMm / 25.4 * 100)
  $paper = [Drawing.Printing.PaperSize]::new('LOGOFF_ONE_LABEL', $paperWidth, $paperHeight)
  $paper.RawKind = 256
  $doc.PrinterSettings.PrinterName = $printer
  $doc.PrinterSettings.Copies = 1
  $doc.PrintController = [Drawing.Printing.StandardPrintController]::new()
  $doc.OriginAtMargins = $false
  $doc.DefaultPageSettings.Landscape = $false
  $doc.DefaultPageSettings.Color = $false
  $doc.DefaultPageSettings.Margins = [Drawing.Printing.Margins]::new(0, 0, 0, 0)
  $doc.DefaultPageSettings.PaperSize = $paper
  $doc.PrinterSettings.DefaultPageSettings.PaperSize = $paper
  $handler = [Drawing.Printing.PrintPageEventHandler]{ param($sender, $eventArgs)
    $eventArgs.PageSettings.PaperSize = $paper
    $eventArgs.PageSettings.Margins = [Drawing.Printing.Margins]::new(0, 0, 0, 0)
    $eventArgs.Graphics.PageUnit = [Drawing.GraphicsUnit]::Display
    $eventArgs.Graphics.DrawImage($image, [Drawing.RectangleF]::new(0, 0, $paperWidth, $paperHeight))
    $eventArgs.HasMorePages = $false
  }
  $doc.add_PrintPage($handler)
  try { $doc.Print() } finally { $doc.remove_PrintPage($handler); $doc.Dispose(); $image.Dispose(); $stream.Dispose() }
}

function Print-SortingLabel($job, [string]$printer, [int]$widthMm, [int]$heightMm) {
  # FIX: exactly the same server-rendered image as direct WMS printing; no second template.
  if (-not $job.sortingLabel.imageBase64 -or $job.sortingLabel.contentType -ne 'image/png') { throw 'Update the WMS server: sorting label is unavailable.' }
  Print-OneLabel ([Convert]::FromBase64String($job.sortingLabel.imageBase64)) $printer $widthMm $heightMm
}

$cfg = Read-Config
$installed = [Drawing.Printing.PrinterSettings]::InstalledPrinters
if (-not ($installed -contains $cfg.printerName)) { throw "Printer '$($cfg.printerName)' is not installed." }
while ($true) {
  try {
    Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/heartbeat" @{} | Out-Null
    $job = Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/claim" @{}
    if ($job) {
      try {
        # Validate both labels before the first physical print to avoid a half-printed pair.
        if (-not $job.sortingLabel.imageBase64 -or $job.sortingLabel.contentType -ne 'image/png') { throw 'Update the WMS server: sorting label is unavailable.' }
        Print-OneLabel ([Convert]::FromBase64String($job.stickerBase64)) $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
        Print-SortingLabel $job $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
        Invoke-WmsApi Post "/marketplace-connections/fbs/print-jobs/$($job.id)/result" @{ success = $true } | Out-Null
      } catch {
        Invoke-WmsApi Post "/marketplace-connections/fbs/print-jobs/$($job.id)/result" @{ success = $false; error = $_.Exception.Message } | Out-Null
      }
    }
  } catch { $script:token = $null }
  Start-Sleep -Seconds 2
}
