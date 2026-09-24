param([string]$ConfigPath = "$PSScriptRoot\config.json")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Read-Config { Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json }

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
function Invoke-WmsApi($method, $path, $body = $null) {
  $cfg = Read-Config
  if (-not $script:token) {
    $authBody = @{ email = $cfg.login; password = $cfg.password } | ConvertTo-Json
    # FIX: send Cyrillic WMS logins as UTF-8 bytes in Windows PowerShell 5.1.
    $auth = Invoke-RestMethod -Method Post -Uri "$($cfg.server)/api/v1/auth/login" -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($authBody))
    $script:token = $auth.accessToken
  }
  $request = @{ Method = $method; Uri = "$($cfg.server)/api/v1$path"; Headers = @{ Authorization = "Bearer $script:token" }; ContentType = 'application/json; charset=utf-8' }
  if ($null -ne $body) { $request.Body = [System.Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10)) }
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
  # FIX: exactly the same server-rendered image as direct WMS printing; no second template.
  if (-not $job.sortingLabel.imageBase64 -or $job.sortingLabel.contentType -ne 'image/png') { throw 'Update the WMS server: sorting label is unavailable.' }
  Print-OneLabel ([Convert]::FromBase64String($job.sortingLabel.imageBase64)) $printer $widthMm $heightMm
}

try {
  $cfg = Read-Config
  $installed = [Drawing.Printing.PrinterSettings]::InstalledPrinters
  if (-not ($installed -contains $cfg.printerName)) { throw "Printer '$($cfg.printerName)' is not installed for this Windows user." }
} catch {
  Write-AgentError 'startup' $_
  throw
}
while ($true) {
  try {
    Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/heartbeat" @{} | Out-Null
    $job = Invoke-WmsApi Post "/marketplace-connections/fbs/print-stations/$($cfg.stationId)/claim" @{}
    if ($job) {
      try {
        $primaryImage = [Convert]::FromBase64String($job.stickerBase64)
        $isRelabel = $job.source -eq 'TSD_RELABEL'
        # FIX: validate the full pair before printing either WB/service or two relabel labels.
        if (-not $job.sortingLabel.imageBase64 -or $job.sortingLabel.contentType -ne 'image/png') {
          throw 'The second label image is unavailable. Refresh the task before printing.'
        }
        $secondImage = [Convert]::FromBase64String($job.sortingLabel.imageBase64)
        if ($isRelabel -and [Convert]::ToBase64String($primaryImage) -cne [Convert]::ToBase64String($secondImage)) {
          throw 'Relabel target label images do not match.'
        }
        Print-OneLabel $primaryImage $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
        if ($isRelabel) {
          Print-OneLabel $secondImage $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
        } else {
          Print-SortingLabel $job $cfg.printerName $cfg.labelWidthMm $cfg.labelHeightMm
        }
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
  } catch {
    Write-AgentError 'connection' $_
    $script:token = $null
  }
  Start-Sleep -Seconds 2
}
