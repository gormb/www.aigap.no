using UnrealBuildTool;
using System.Collections.Generic;

public class LddMinTarget : TargetRules
{
	public LddMinTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V8;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;
		ExtraModuleNames.Add("Vignette");
	}
}
