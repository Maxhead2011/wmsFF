using UnrealBuildTool;
public class DurakArenaTarget : TargetRules {
    public DurakArenaTarget(TargetInfo Target) : base(Target) {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("DurakArena");
    }
}
