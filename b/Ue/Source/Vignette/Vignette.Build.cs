using UnrealBuildTool;

public class Vignette : ModuleRules
{
	public Vignette(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.NoPCHs;
		bUseUnity = false;

		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "UMG", "HTTP", "ImageWrapper" });
	}
}
