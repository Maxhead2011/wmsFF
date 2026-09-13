param([Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
# FIX: package only public sources, never local config.json or saved credentials.
$files = @('Install-Agent.cmd', 'Setup-Agent.ps1', 'LOGOFF-FBS-Print-Agent.ps1', 'WmsApi.ps1', 'README.txt')
$destination = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $destination) { throw 'Output already exists; choose another output path.' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('logoff-print-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  foreach ($name in $files) {
    $source = Join-Path $PSScriptRoot $name
    $target = Join-Path $stage $name
    # Windows PowerShell 5 requires a BOM to read Cyrillic source text reliably.
    if ($name.EndsWith('.ps1')) {
      [IO.File]::WriteAllText($target, [IO.File]::ReadAllText($source, [Text.Encoding]::UTF8), [Text.UTF8Encoding]::new($true))
    } else { Copy-Item -LiteralPath $source -Destination $target }
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $destination)
  Write-Output $destination
} finally {
  foreach ($name in $files) {
    $target = Join-Path $stage $name
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
  }
  Remove-Item -LiteralPath $stage
}
