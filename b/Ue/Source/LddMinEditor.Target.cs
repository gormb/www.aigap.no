using UnrealBuildTool;
using System.Collections.Generic;

public class LddMinEditorTarget : TargetRules
{
	public LddMinEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V8;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;
		ExtraModuleNames.Add("Vignette");
	}
}
