#include "VignetteHUD.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Blueprint/UserWidget.h"

void AVignetteHUD::DrawHUD()
{
	Super::DrawHUD();
}

void AVignetteHUD::BeginPlay()
{
	Super::BeginPlay();

	if (APlayerController* PlayerController = GetOwningPlayerController())
	{
		TSubclassOf<UUserWidget> QrWidgetClass =
			LoadClass<UUserWidget>(nullptr, TEXT("/Game/UI/QR/WBP_QrCode.WBP_QrCode_C"));
		if (QrWidgetClass)
		{
			if (UUserWidget* QrWidget = CreateWidget<UUserWidget>(PlayerController, QrWidgetClass))
			{
				QrWidget->AddToViewport(100);
			}
		}
	}
}
