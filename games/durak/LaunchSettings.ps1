function Get-DurakLaunchArguments {
    param(
        [Parameter(Mandatory = $true)][string]$Project,
        [ValidateSet('Windowed', '2K', 'FHD')][string]$Resolution = 'Windowed',
        [switch]$Showcase
    )
    # FIX: a usable normal window; allow UE to constrain requests to desktop bounds.
    $durakWidth = if ($Resolution -eq '2K') { 2560 } elseif ($Resolution -eq 'FHD') { 1920 } else { 1280 }
    $durakHeight = if ($Resolution -eq '2K') { 1440 } elseif ($Resolution -eq 'FHD') { 1080 } else { 720 }
    @(
        ('"' + $Project + '"'), '/Game/Arena', '-game', '-windowed',
        "-ResX=$durakWidth", "-ResY=$durakHeight", '-nosplash', '-NoScreenMessages',
        '-ExecCmds="r.ScreenPercentage 100,r.DynamicRes.OperationMode 0,r.SecondaryScreenPercentage.GameViewport 100"'
    )
    if ($Showcase) { '-DuelShowcase' }
}
