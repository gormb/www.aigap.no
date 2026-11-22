#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "VignetteHUD.generated.h"

UCLASS()
class VIGNETTE_API AVignetteHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
};
