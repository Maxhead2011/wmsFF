using UnrealBuildTool;
public class DurakArena : ModuleRules {
    public DurakArena(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        // FIX: runtime cinematic playback, no editor-only dependency in the game module.
        PublicDependencyModuleNames.AddRange(new[] {"Core","CoreUObject","Engine","InputCore","LevelSequence","MovieScene"});
    }
}
