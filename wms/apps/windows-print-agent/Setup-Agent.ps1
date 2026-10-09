param([switch]$SelfTest)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'WmsApi.ps1')
. (Join-Path $PSScriptRoot 'JobJournal.ps1')
. (Join-Path $PSScriptRoot 'AgentLifecycle.ps1')

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  if (-not $SelfTest) { Assert-AgentInteractiveUser }
  $script:savedConfig = if ($SelfTest) { $null } else { Get-SavedAgentConfig $PSScriptRoot }
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

  # FIX: an existing station is reused by ID, never re-registered under today's name.
  if ($script:savedConfig) {
    $login.Text = $script:savedConfig.login
    $password.Text = $script:savedConfig.password
    $name.Text = $script:savedConfig.stationName
    $name.ReadOnly = $true
    $printer.SelectedItem = $script:savedConfig.printerName
    $printer.Enabled = $false
    $model.Enabled = $false
    $hint.Text = 'Saved station: ' + $script:savedConfig.stationName + '. Windows user: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $button.Text = 'START / UPDATE SAVED STATION'
  }

  $button.Add_Click({
    try {
      if (-not $login.Text.Trim() -or -not $password.Text -or -not $printer.SelectedItem) {
        throw 'Enter WMS login and password and select a printer.'
      }
      $button.Enabled = $false
      $status.Text = 'Connecting to WMS...'
      [System.Windows.Forms.Application]::DoEvents()

      $server = if ($script:savedConfig) { $script:savedConfig.server } else { 'https://wms.logoff.pro' }
      $script:setupConfig = @{server=$server;login=$login.Text.Trim();password=$password.Text}
      $script:token = $null
      if ($script:savedConfig) {
        $cfg = $script:savedConfig
        $cfg.login = $login.Text.Trim()
        $cfg.password = $password.Text
      } else {
        $isNiimbot = $model.SelectedItem -eq 'NIIMBOT B1'
        $width = if ($isNiimbot) { 50 } else { 58 }
        $height = if ($isNiimbot) { 30 } else { 40 }
        $station = Invoke-WmsApi Post '/marketplace-connections/fbs/print-stations' @{
          name=$name.Text.Trim();printerName=[string]$printer.SelectedItem
          printerModel=[string]$model.SelectedItem;labelWidthMm=$width;labelHeightMm=$height
        }
        $cfg = [pscustomobject]@{server=$server;login=$login.Text.Trim();password=$password.Text;stationId=$station.id;stationName=$station.name;printerName=$station.printerName;labelWidthMm=$width;labelHeightMm=$height}
        # Keep the returned ID even if local installation fails and the operator retries.
        $script:savedConfig = $cfg
        $name.ReadOnly = $true
      }
      $agentHome = Install-AgentFiles $PSScriptRoot $cfg
      $status.Text = 'Agent started. Checking WMS connection...'
      [System.Windows.Forms.Application]::DoEvents()
      $online = $false
      for ($i=0; $i -lt 15; $i++) {
        $statePath = Join-Path $agentHome 'status.json'
        if (Test-Path -LiteralPath $statePath) {
          $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
          if ($state.stage -eq 'connected' -and ([DateTime]::UtcNow - [DateTime]::Parse($state.updatedAt)).TotalSeconds -lt 35) { $online = $true; break }
        }
        Start-Sleep -Seconds 1
        [System.Windows.Forms.Application]::DoEvents()
      }
      if (-not $online) { throw "Agent installed and will retry automatically. Check connection and printer. Diagnostics: $agentHome\status.json and agent.log. Do not create a new station." }

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
