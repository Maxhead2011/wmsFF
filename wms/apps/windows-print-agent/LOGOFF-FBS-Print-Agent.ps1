param([string]$ConfigPath = "$PSScriptRoot\config.json", [switch]$LibraryOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'WmsApi.ps1')
. (Join-Path $PSScriptRoot 'JobJournal.ps1')
. (Join-Path $PSScriptRoot 'AgentLifecycle.ps1')
. (Join-Path $PSScriptRoot 'PrintSeries.ps1')
# FIX: errors before the first heartbeat were previously invisible to the operator.
function Write-AgentError([string]$stage, $errorRecord) {
  try {
    $message = [string]$errorRecord.Exception.Message
    $message = $message -replace '(?i)Bearer\s+\S+', 'Bearer [hidden]'
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$stage] $message"
    $errorKey = "[$stage] $message"
    if ($errorKey -eq $script:lastAgentError -and ((Get-Date) - $script:lastAgentErrorAt).TotalSeconds -lt 60) { return }
    $script:lastAgentError = $errorKey
    $script:lastAgentErrorAt = Get-Date
    $logPath = Join-Path $PSScriptRoot 'agent.log'
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 65536) { Clear-Content -LiteralPath $logPath }
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  } catch { }
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
  # FIX: exactly the same server-rendered image as direct WMS printing; no second template.
  if (-not $job.sortingLabel.imageBase64 -or $job.sortingLabel.contentType -ne 'image/png') { throw 'Update the WMS server: sorting label is unavailable.' }
  Print-OneLabel ([Convert]::FromBase64String($job.sortingLabel.imageBase64)) $printer $widthMm $heightMm
}

function Invoke-AgentQueueCycle($cfg) {
  Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/heartbeat" @{} | Out-Null
  Sync-PrintResults 'fbs'
  Sync-PrintResults 'label'
  $job = Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/claim" @{}
  if ($job) {
    Invoke-DurablePrint $cfg 'fbs' $job.id {
      $primaryImage = [Convert]::FromBase64String($job.stickerBase64)
      $isRelabel = $job.source -eq 'TSD_RELABEL'
      # FIX: preserve published full-pair validation and exact label images.
      if (-not $job.sortingLabel.imageBase64 -or $job.sortingLabel.contentType -ne 'image/png') { throw 'The second label image is unavailable. Refresh the task before printing.' }
      $secondImage = [Convert]::FromBase64String($job.sortingLabel.imageBase64)
      if ($isRelabel -and [Convert]::ToBase64String($primaryImage) -cne [Convert]::ToBase64String($secondImage)) { throw 'Relabel target label images do not match.' }
      Print-OneLabel $primaryImage $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
      if ($isRelabel) { Print-OneLabel $secondImage $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm }
      else { Print-SortingLabel $job $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm }
    }
  } else {
    $label = Invoke-WmsApi Post "/print/agent-stations/$($cfg.stationId)/claim" @{}
    if ($label) {
      Invoke-DurablePrint $cfg 'label' $label.id {
        $image = [Convert]::FromBase64String($label.imageBase64)
        for ($copy = 0; $copy -lt [int]$label.copies; $copy++) {
          Print-OneLabel $image $cfg.printerName ([int]$label.widthMm) ([int]$label.heightMm)
        }
      }
    }
  }
}
if ($LibraryOnly) { return }
try {
  $cfg = Read-Config
  if (-not (Enter-AgentMutex $cfg)) { return }
  $script:agentStartedAt = [DateTime]::UtcNow.ToString('o')
  Initialize-PrintJournal $cfg (Join-Path $PSScriptRoot 'journal')
  $script:connectionFailures = 0
  while (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'stop.request'))) {
    $queueOk = $false
    try {
      if (-not ([Drawing.Printing.PrinterSettings]::InstalledPrinters -contains $cfg.printerName)) { throw "Printer '$($cfg.printerName)' is not installed for this Windows user." }
      Invoke-AgentQueueCycle $cfg
      $queueOk = $true
      $script:connectionFailures = 0
      Write-AgentState 'connected'
    } catch {
      Write-AgentError 'connection-or-print' $_
      Write-AgentState 'retrying' $_.Exception.Message
      $script:connectionFailures++
    }
    try { if (Invoke-PrintSeriesCycle $cfg) { continue } } catch { Write-AgentError 'series' $_ }
    # FIX: healthy polling remains 2s; only connection failures back off, capped at 30s.
    $delay = if ($queueOk) { 2 } else { [Math]::Min(30, [Math]::Pow(2, [Math]::Min(5,$script:connectionFailures))) }
    Start-Sleep -Seconds $delay
  }
} catch {
  Write-AgentError 'startup' $_
  Write-AgentState 'startup-error' $_.Exception.Message
  throw
} finally {
  if ($script:ownsAgentMutex) { $script:agentMutex.ReleaseMutex() }
  if ($script:agentMutex) { $script:agentMutex.Dispose() }
}
