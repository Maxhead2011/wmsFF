param(
    [ValidateSet('Windowed', '2K', 'FHD')][string]$Resolution = 'Windowed',
    [switch]$Showcase
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'LaunchSettings.ps1')
$durakEditor = 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe'
$durakProject = Join-Path $PSScriptRoot 'unreal\DurakArena\DurakArena.uproject'
if (!(Test-Path $durakEditor)) { throw 'Unreal Engine 5.8 is required for this development preview.' }
if (!(Test-Path (Join-Path $PSScriptRoot 'unreal\DurakArena\Content\Arena.umap'))) { throw 'Build game assets before launching. See README.md.' }
# The user-facing interactive preview is intentionally visible.
$durakArguments = @(Get-DurakLaunchArguments -Project $durakProject -Resolution $Resolution -Showcase:$Showcase)
Start-Process -FilePath $durakEditor -ArgumentList $durakArguments
