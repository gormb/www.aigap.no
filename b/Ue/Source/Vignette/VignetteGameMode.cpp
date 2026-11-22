#include "VignetteGameMode.h"
#include "VignetteHUD.h"
#include "VignetteCharacter.h"
#include "GameFramework/PlayerController.h"

AVignetteGameMode::AVignetteGameMode()
{
	HUDClass = AVignetteHUD::StaticClass();
	DefaultPawnClass = AVignetteCharacter::StaticClass();
	PlayerControllerClass = APlayerController::StaticClass();
}

void AVignetteGameMode::StartPlay()
{
	Super::StartPlay();

	UE_LOG(LogTemp, Display, TEXT("Hello World from VignetteGameMode"));
}
