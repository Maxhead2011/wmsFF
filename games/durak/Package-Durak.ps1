param([string]$ReleaseName='windows-20260908')
$ErrorActionPreference='Stop'
if($ReleaseName -notmatch '^windows-[a-zA-Z0-9-]+$'){throw 'Use an isolated windows-* release name.'}
$durakOutput=Join-Path $PSScriptRoot ('build/'+$ReleaseName)
$durakProject=Join-Path $PSScriptRoot 'unreal/DurakArena/DurakArena.uproject'
$durakUat='C:/Program Files/Epic Games/UE_5.8/Engine/Build/BatchFiles/RunUAT.bat'
if(Get-Process UnrealEditor* -ErrorAction SilentlyContinue){throw 'Close the game/editor before packaging.'}
# FIX: cook a standalone game; do not distribute editor binaries or source asset packs.
& $durakUat BuildCookRun "-project=$durakProject" -noP4 -platform=Win64 -clientconfig=Development -build -cook -stage -pak -compressed -prereqs -archive "-archivedirectory=$durakOutput" -utf8output -unattended '-UbtArgs=-MaxParallelActions=2 -NoUBA'
if($LASTEXITCODE -ne 0){throw "Unreal packaging failed ($LASTEXITCODE). Nothing was published."}
Write-Output "DURAK_PACKAGE_READY $durakOutput"
