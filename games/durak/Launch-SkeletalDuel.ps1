param([ValidateSet('Windowed','2K','FHD')][string]$Resolution='Windowed', [switch]$PrintArguments)
$ErrorActionPreference='Stop'
# FIX: independent cinematic launcher, never changes the card-game default.
$durakArgs=@(& (Join-Path $PSScriptRoot 'Launch-RealisticPreview.ps1') -Resolution $Resolution -PrintArguments)
$durakArgs[1]='/Game/Art/SkeletalDuelArena?game=/Game/Art/BP_RealisticPreviewMode.BP_RealisticPreviewMode_C'
if ($PrintArguments) { $durakArgs; return }
if (!(Test-Path (Join-Path $PSScriptRoot 'unreal/DurakArena/Content/Art/SkeletalDuel.uasset'))) { throw 'Build art/build_skeletal_duel.py in Unreal first.' }
Start-Process -FilePath 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe' -ArgumentList $durakArgs
