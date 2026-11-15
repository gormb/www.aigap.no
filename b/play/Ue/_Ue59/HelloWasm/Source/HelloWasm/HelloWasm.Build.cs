// Copyright Epic Games, Inc. All Rights Reserved.

using UnrealBuildTool;

public class HelloWasm : ModuleRules
{
	public HelloWasm(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] {
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"AIModule",
			"StateTreeModule",
			"GameplayStateTreeModule",
			"UMG",
			"Slate"
		});

		PrivateDependencyModuleNames.AddRange(new string[] { });

		PublicIncludePaths.AddRange(new string[] {
			"HelloWasm",
			"HelloWasm/Variant_Platforming",
			"HelloWasm/Variant_Platforming/Animation",
			"HelloWasm/Variant_Combat",
			"HelloWasm/Variant_Combat/AI",
			"HelloWasm/Variant_Combat/Animation",
			"HelloWasm/Variant_Combat/Gameplay",
			"HelloWasm/Variant_Combat/Interfaces",
			"HelloWasm/Variant_Combat/UI",
			"HelloWasm/Variant_SideScrolling",
			"HelloWasm/Variant_SideScrolling/AI",
			"HelloWasm/Variant_SideScrolling/Gameplay",
			"HelloWasm/Variant_SideScrolling/Interfaces",
			"HelloWasm/Variant_SideScrolling/UI"
		});

		// Uncomment if you are using Slate UI
		// PrivateDependencyModuleNames.AddRange(new string[] { "Slate", "SlateCore" });

		// Uncomment if you are using online features
		// PrivateDependencyModuleNames.Add("OnlineSubsystem");

		// To include OnlineSubsystemSteam, add it to the plugins section in your uproject file with the Enabled attribute set to true
	}
}
