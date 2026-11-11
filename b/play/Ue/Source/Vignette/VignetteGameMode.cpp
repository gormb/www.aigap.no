#include "VignetteGameMode.h"
#include "VignetteHUD.h"

AVignetteGameMode::AVignetteGameMode()
{
	HUDClass = AVignetteHUD::StaticClass();
}

void AVignetteGameMode::StartPlay()
{
	Super::StartPlay();

	UE_LOG(LogTemp, Display, TEXT("Hello World from VignetteGameMode"));
}
