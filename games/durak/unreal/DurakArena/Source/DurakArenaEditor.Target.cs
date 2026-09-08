using UnrealBuildTool;
public class DurakArenaEditorTarget : TargetRules {
    public DurakArenaEditorTarget(TargetInfo Target) : base(Target) {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("DurakArena");
    }
}
