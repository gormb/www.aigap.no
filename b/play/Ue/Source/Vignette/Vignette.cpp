#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogVignette, Log, All);

class FVignetteModule : public FDefaultGameModuleImpl
{
public:
	virtual void StartupModule() override
	{
		UE_LOG(LogVignette, Display, TEXT("Hello World from Vignette"));
	}
};

IMPLEMENT_PRIMARY_GAME_MODULE(FVignetteModule, Vignette, "Vignette");
