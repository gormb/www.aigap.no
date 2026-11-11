#include "VignetteHUD.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"

void AVignetteHUD::DrawHUD()
{
	Super::DrawHUD();

	if (!Canvas)
	{
		return;
	}

	const FString Message = TEXT("Hello World");
	const float Scale = 3.0f;

	float TextWidth = 0.0f;
	float TextHeight = 0.0f;
	GetTextSize(Message, TextWidth, TextHeight, nullptr, Scale);

	const float X = (Canvas->SizeX - TextWidth) * 0.5f;
	const float Y = (Canvas->SizeY - TextHeight) * 0.5f;

	DrawText(Message, FLinearColor::White, X, Y, nullptr, Scale);
}
