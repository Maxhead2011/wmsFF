param([string]$ConfigPath = "$PSScriptRoot\config.json")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Read-Config { Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json }
function Invoke-WmsApi($method, $path, $body = $null) {
  $cfg = Read-Config
  if (-not $script:token) {
    $authBody = @{ email = $cfg.login; password = $cfg.password } | ConvertTo-Json
    $auth = Invoke-RestMethod -Method Post -Uri "$($cfg.server)/api/v1/auth/login" -ContentType 'application/json' -Body $authBody
    $script:token = $auth.accessToken
  }
  $request = @{ Method = $method; Uri = "$($cfg.server)/api/v1$path"; Headers = @{ Authorization = "Bearer $script:token" }; ContentType = 'application/json' }
  if ($null -ne $body) { $request.Body = $body | ConvertTo-Json -Depth 10 }
  try { Invoke-RestMethod @request } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 401) { $script:token = $null; return Invoke-WmsApi $method $path $body }
    throw
  }
}

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
  $bitmap = [Drawing.Bitmap]::new([int]($widthMm / 25.4 * 300), [int]($heightMm / 25.4 * 300))
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([Drawing.Color]::White)
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $center = [Drawing.StringFormat]::new(); $center.Alignment = 'Center'
  $small = [Drawing.Font]::new('Arial', 12, [Drawing.FontStyle]::Bold)
  $big = [Drawing.Font]::new('Arial', 21, [Drawing.FontStyle]::Bold)
  $device = if ([string]::IsNullOrWhiteSpace($job.deviceCode)) { 'TSD' } else { [string]$job.deviceCode }
  $request = if ($null -eq $job.requestNumber) { '-' } else { ('{0:D6}' -f [int]$job.requestNumber) }
  $lines = @(@('TSD', $device), @('WMS REQUEST', $request), @('ORDER', [string]$job.orderId), @('WAREHOUSE', [string]$job.warehouseName))
  $widthPx = $bitmap.Width; $row = [Math]::Floor($bitmap.Height / 4); $y = 0
  foreach ($line in $lines) {
    $graphics.DrawString($line[0], $small, [Drawing.Brushes]::Black, [Drawing.RectangleF]::new(0, $y, $widthPx, $row * 0.35), $center)
    $graphics.DrawString($line[1], $big, [Drawing.Brushes]::Black, [Drawing.RectangleF]::new(0, $y + $row * 0.30, $widthPx, $row * 0.70), $center)
    $y += $row
  }
  $memory = [IO.MemoryStream]::new()
  try { $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png); Print-OneLabel $memory.ToArray() $printer $widthMm $heightMm }
  finally { $small.Dispose(); $big.Dispose(); $center.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $memory.Dispose() }
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
        Print-OneLabel ([Convert]::FromBase64String($job.stickerBase64)) $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
        Print-SortingLabel $job $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
        Invoke-WmsApi Post "/marketplace-connections/fbs/print-jobs/$($job.id)/result" @{ success = $true } | Out-Null
      } catch {
        Invoke-WmsApi Post "/marketplace-connections/fbs/print-jobs/$($job.id)/result" @{ success = $false; error = $_.Exception.Message } | Out-Null
      }
    } else {
      # FIX: FBS keeps priority; generic SKU labels use the same working Windows printer.
      $label = Invoke-WmsApi Post "/print/agent-stations/$($cfg.stationId)/claim" @{}
      if ($label) {
        try {
          $image = [Convert]::FromBase64String($label.imageBase64)
          for ($copy = 0; $copy -lt [int]$label.copies; $copy++) {
            Print-OneLabel $image $cfg.printerName ([int]$label.widthMm) ([int]$label.heightMm)
          }
          Invoke-WmsApi Post "/print/agent-jobs/$($label.id)/result" @{ success = $true } | Out-Null
        } catch {
          Invoke-WmsApi Post "/print/agent-jobs/$($label.id)/result" @{ success = $false; error = $_.Exception.Message } | Out-Null
        }
      }
    }
  } catch { $script:token = $null }
  Start-Sleep -Seconds 2
}
