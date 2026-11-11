#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "VignetteGameMode.generated.h"

UCLASS()
class VIGNETTE_API AVignetteGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AVignetteGameMode();

	virtual void StartPlay() override;
};
