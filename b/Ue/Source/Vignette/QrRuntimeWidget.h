#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "TimerManager.h"
#include "QrRuntimeWidget.generated.h"

class UImage;
class UTextBlock;

UCLASS()
class VIGNETTE_API UQrRuntimeWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	virtual void NativeConstruct() override;
	virtual void NativeDestruct() override;

	UFUNCTION(BlueprintCallable, Category = "QR")
	void RefreshQr();

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	FString BaseUrl = TEXT("https://aigap.no/");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	int32 QrIndex = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	float RefreshSeconds = 30.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	int32 FetchCounter = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "QR")
	FString QrSelection;

protected:
	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UImage> QrImage;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UTextBlock> QrText;

	void FetchImage();
	void FetchText();
	void ApplySelectionFromMarkdown(const FString& Markdown);
	FString SelectSectionFromMarkdown(const FString& Markdown) const;

	FTimerHandle RefreshTimerHandle;
};
