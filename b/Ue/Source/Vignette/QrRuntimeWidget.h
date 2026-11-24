#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "TimerManager.h"
#include "QrRuntimeWidget.generated.h"

class UBorder;
class UImage;
class UScrollBox;
class USizeBox;
class UTextBlock;
class UTexture2D;

UCLASS()
class VIGNETTE_API UQrRuntimeWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	virtual void NativeConstruct() override;
	virtual void NativeDestruct() override;

	UFUNCTION(BlueprintCallable, Category = "QR")
	void RefreshQr();

	UFUNCTION(BlueprintCallable, Category = "QR")
	void SetQrSelection(const FString& Selection);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	int32 QrIndex = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	float RefreshSeconds = 7200.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	int32 FetchCounter = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	FString QrSelection;

	// Exact on-screen QR size. A 21x21 atlas tile shown at 84 px keeps an integer 4 px per module.
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	float QrDisplaySize = 84.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	FVector2D PanelSize = FVector2D(420.0f, 480.0f);

	// White quiet zone around the code, in pixels (4 modules at the 84 px display size).
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	float QuietZonePad = 16.0f;

protected:
	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UImage> QrImage;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UTextBlock> QrText;

	UPROPERTY(meta = (BindWidgetOptional))
	TObjectPtr<USizeBox> QrSizeBox;

	UPROPERTY(meta = (BindWidgetOptional))
	TObjectPtr<USizeBox> QrTileBox;

	UPROPERTY(meta = (BindWidgetOptional))
	TObjectPtr<UBorder> QrQuietZone;

	UPROPERTY(meta = (BindWidgetOptional))
	TObjectPtr<UScrollBox> QrScrollBox;

	UPROPERTY(Transient)
	TObjectPtr<UTexture2D> CurrentQrTexture;

	TArray<uint8> CachedAtlasPng;

	void FetchImage();
	void FetchText();
	void EnsureWidgetBindings();
	void ApplyLayout();
		FString SiteUrl(const TCHAR* FileName) const;
	void DisplayQrTile(const TArray<uint8>& PngData);
	void ApplySelectionFromMarkdown(const FString& Markdown);
	FString SelectSectionFromMarkdown(const FString& Markdown) const;
	FString FormatMarkdownForDisplay(const FString& Markdown) const;

	FTimerHandle RefreshTimerHandle;
	FTimerHandle LayoutTimerHandle;
};
