param(
    [ValidateSet('Windowed','2K','FHD')][string]$Resolution='Windowed',
    [switch]$PrintArguments
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'LaunchSettings.ps1')
$durakEditor='C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe'
$durakProject=Join-Path $PSScriptRoot 'unreal\DurakArena\DurakArena.uproject'
# FIX: isolated asset review; never replaces the playable card table or its game mode.
$durakArguments=@(Get-DurakLaunchArguments -Project $durakProject -Resolution $Resolution)
$durakArguments[1]='/Game/Art/RealisticPreview?game=/Game/Art/BP_RealisticPreviewMode.BP_RealisticPreviewMode_C'
# This preview uses supported conventional shadows; global renderer configuration is unchanged.
$durakArguments+='-ini:Engine:[/Script/Engine.RendererSettings]:r.Shadow.Virtual.Enable=0'
if ($PrintArguments) { $durakArguments; return }
if (!(Test-Path $durakEditor)) { throw 'Unreal Engine 5.8 is required.' }
if (!(Test-Path (Join-Path $PSScriptRoot 'unreal\DurakArena\Content\Art\RealisticPreview.umap'))) {
    throw 'Build the preview first using art/build_realistic_preview.py in Unreal.'
}
Start-Process -FilePath $durakEditor -ArgumentList $durakArguments
