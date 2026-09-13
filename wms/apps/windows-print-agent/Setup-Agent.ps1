param([switch]$SelfTest)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'WmsApi.ps1')

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'LOGOFF - FBS Print Station Setup'
  $form.Width = 560
  $form.Height = 540
  $form.StartPosition = 'CenterScreen'
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false

  function New-Label([string]$text, [int]$left, [int]$top, [int]$width, [int]$height) {
    $control = New-Object System.Windows.Forms.Label
    $control.Text = $text
    $control.Left = $left
    $control.Top = $top
    $control.Width = $width
    $control.Height = $height
    return $control
  }

  function New-Input([string]$caption, [int]$top, [bool]$passwordField) {
    $label = New-Label $caption 26 $top 490 22
    $input = New-Object System.Windows.Forms.TextBox
    $input.Left = 26
    $input.Top = $top + 23
    $input.Width = 490
    $input.Height = 32
    $input.UseSystemPasswordChar = $passwordField
    $form.Controls.Add($label)
    $form.Controls.Add($input)
    return $input
  }

  $title = New-Label 'Connect printer to FBS Assembly' 24 20 490 38
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
  $hint = New-Label 'Enter your WMS login and password, then select the Windows printer.' 26 62 490 38
  $hint.ForeColor = [System.Drawing.Color]::FromArgb(85, 96, 115)

  $login = New-Input 'WMS login' 108 $false
  $password = New-Input 'WMS password' 170 $true

  $printerLabel = New-Label 'Windows printer' 26 232 490 22
  $printer = New-Object System.Windows.Forms.ComboBox
  $printer.Left = 26; $printer.Top = 255; $printer.Width = 490; $printer.Height = 34
  $printer.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
  [System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [void]$printer.Items.Add($_) }
  if ($printer.Items.Count -gt 0) { $printer.SelectedIndex = 0 }

  $modelLabel = New-Label 'Printer model' 26 300 230 22
  $model = New-Object System.Windows.Forms.ComboBox
  $model.Left = 26; $model.Top = 323; $model.Width = 230; $model.Height = 34
  $model.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
  @('TSC TE-200', 'XP-365B', 'NIIMBOT B1') | ForEach-Object { [void]$model.Items.Add($_) }
  $model.SelectedIndex = 0

  $nameLabel = New-Label 'Station name' 276 300 240 22
  $name = New-Object System.Windows.Forms.TextBox
  $name.Left = 276; $name.Top = 323; $name.Width = 240; $name.Height = 34
  $name.Text = 'ASSEMBLY - ' + $env:COMPUTERNAME

  $button = New-Object System.Windows.Forms.Button
  $button.Text = 'CONNECT AND START'
  $button.Left = 26; $button.Top = 382; $button.Width = 490; $button.Height = 52
  $button.BackColor = [System.Drawing.Color]::FromArgb(225, 22, 34)
  $button.ForeColor = [System.Drawing.Color]::White
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)

  $status = New-Label '' 26 443 490 46
  $status.ForeColor = [System.Drawing.Color]::FromArgb(20, 115, 65)

  $form.Controls.AddRange(@($title, $hint, $printerLabel, $printer, $modelLabel, $model, $nameLabel, $name, $button, $status))

  $button.Add_Click({
    try {
      if (-not $login.Text.Trim() -or -not $password.Text -or -not $printer.SelectedItem) {
        throw 'Enter WMS login and password and select a printer.'
      }
      $button.Enabled = $false
      $status.Text = 'Connecting to WMS...'
      [System.Windows.Forms.Application]::DoEvents()

      $server = 'https://wms.logoff.pro'
      # FIX: share the background agent's UTF-8 login path for Cyrillic accounts such as Sklad.
      $script:setupConfig = @{ server = $server; login = $login.Text.Trim(); password = $password.Text }
      $script:token = $null
      $isNiimbot = $model.SelectedItem -eq 'NIIMBOT B1'
      $width = if ($isNiimbot) { 50 } else { 58 }
      $height = if ($isNiimbot) { 30 } else { 40 }
      $stationBody = @{
        name = $name.Text.Trim(); printerName = [string]$printer.SelectedItem
        printerModel = [string]$model.SelectedItem; labelWidthMm = $width; labelHeightMm = $height
      }
      $station = Invoke-WmsApi Post '/marketplace-connections/fbs/print-stations' $stationBody

      @{
        server = $server; login = $login.Text.Trim(); password = $password.Text
        stationId = $station.id; stationName = $station.name; printerName = $station.printerName
        labelWidthMm = $width; labelHeightMm = $height
      } | ConvertTo-Json | Set-Content -LiteralPath "$PSScriptRoot\config.json" -Encoding UTF8

      $agentPath = Join-Path $PSScriptRoot 'LOGOFF-FBS-Print-Agent.ps1'
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentPath`""
      $trigger = New-ScheduledTaskTrigger -AtLogOn
      $settings = New-ScheduledTaskSettingsSet -RestartCount 100 -RestartInterval (New-TimeSpan -Minutes 1)
      Register-ScheduledTask -TaskName 'LOGOFF FBS Print Agent' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
      Start-ScheduledTask -TaskName 'LOGOFF FBS Print Agent'

      $status.Text = 'Ready. The print station is connected.'
      $button.Text = 'READY'
      [System.Windows.Forms.MessageBox]::Show('Print station connected. Select it in the FBS Assembly app.', 'LOGOFF', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } catch {
      $status.ForeColor = [System.Drawing.Color]::Firebrick
      $status.Text = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
      $button.Enabled = $true
    }
  })

  if ($SelfTest) {
    Write-Output 'SETUP_OK'
    $form.Dispose()
    exit 0
  }

  $form.AcceptButton = $button
  $form.Add_Shown({ $login.Focus() })
  [void]$form.ShowDialog()
} catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'LOGOFF setup error', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  } catch {}
  Write-Error $_
  exit 1
}
