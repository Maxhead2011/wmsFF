param([ValidateSet('Windowed','2K','FHD')][string]$Resolution='Windowed')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'LaunchSettings.ps1')
$durakEditor='C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe'
$durakProject=Join-Path $PSScriptRoot 'unreal\DurakArena\DurakArena.uproject'
if (!(Test-Path $durakEditor)) { throw 'Unreal Engine 5.8 is required.' }
if (!(Test-Path (Join-Path $PSScriptRoot 'unreal\DurakArena\Content\Heroes\Q_Torso.uasset'))) { throw 'Import the hero pair first: see README.' }
# FIX: separate visible art preview; normal launcher still opens the actual card game.
$durakArguments=@(Get-DurakLaunchArguments -Project $durakProject -Resolution $Resolution -Showcase)
$durakArguments+='-DuelScenario=1'
Start-Process -FilePath $durakEditor -ArgumentList $durakArguments
