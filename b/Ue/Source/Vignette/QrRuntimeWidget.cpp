#include "QrRuntimeWidget.h"

#include "Components/Image.h"
#include "Components/TextBlock.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/Texture2D.h"
#include "ImageUtils.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

void UQrRuntimeWidget::NativeConstruct()
{
	Super::NativeConstruct();

	if (RefreshSeconds < 1.0f)
	{
		RefreshSeconds = 1.0f;
	}

	RefreshQr();

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(
			RefreshTimerHandle,
			this,
			&UQrRuntimeWidget::RefreshQr,
			RefreshSeconds,
			true);
	}
}

void UQrRuntimeWidget::NativeDestruct()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(RefreshTimerHandle);
	}

	Super::NativeDestruct();
}

void UQrRuntimeWidget::RefreshQr()
{
	FetchImage();
	FetchText();
	++FetchCounter;
}

void UQrRuntimeWidget::FetchImage()
{
	FString Url = BaseUrl;
	if (!Url.EndsWith(TEXT("/")))
	{
		Url += TEXT("/");
	}
	Url += FString::Printf(TEXT("m.png?v=%d"), FetchCounter);

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
		FHttpModule::Get().CreateRequest();
	Request->SetURL(Url);
	Request->SetVerb(TEXT("GET"));
	Request->OnProcessRequestComplete().BindLambda(
		[this](FHttpRequestPtr HttpRequest, FHttpResponsePtr HttpResponse, bool bSucceeded)
		{
			if (!bSucceeded || !HttpResponse.IsValid() || HttpResponse->GetResponseCode() != 200)
			{
				UE_LOG(LogTemp, Warning, TEXT("QR image download failed"));
				return;
			}

			UTexture2D* Atlas = FImageUtils::ImportBufferAsTexture2D(HttpResponse->GetContent());
			if (!Atlas || !QrImage)
			{
				return;
			}

			UMaterialInstanceDynamic* DynamicMaterial = QrImage->GetDynamicMaterial();
			if (DynamicMaterial)
			{
				DynamicMaterial->SetTextureParameterValue(TEXT("Atlas"), Atlas);
				DynamicMaterial->SetScalarParameterValue(TEXT("Index"), static_cast<float>(QrIndex));
			}
		});
	Request->ProcessRequest();
}

void UQrRuntimeWidget::FetchText()
{
	FString Url = BaseUrl;
	if (!Url.EndsWith(TEXT("/")))
	{
		Url += TEXT("/");
	}
	Url += FString::Printf(TEXT("m.md?v=%d"), FetchCounter);

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
		FHttpModule::Get().CreateRequest();
	Request->SetURL(Url);
	Request->SetVerb(TEXT("GET"));
	Request->OnProcessRequestComplete().BindLambda(
		[this](FHttpRequestPtr HttpRequest, FHttpResponsePtr HttpResponse, bool bSucceeded)
		{
			if (!bSucceeded || !HttpResponse.IsValid() || HttpResponse->GetResponseCode() != 200)
			{
				UE_LOG(LogTemp, Warning, TEXT("QR text download failed"));
				return;
			}

			FString Markdown;
			FFileHelper::BufferToString(Markdown, HttpResponse->GetContent().GetData(),
				HttpResponse->GetContent().Num());
			ApplySelectionFromMarkdown(Markdown);

			FString DisplayText = QrSelection.IsEmpty()
				? Markdown
				: SelectSectionFromMarkdown(Markdown);
			if (DisplayText.IsEmpty())
			{
				DisplayText = Markdown;
			}

			if (QrText)
			{
				QrText->SetText(FText::FromString(DisplayText));
			}
		});
	Request->ProcessRequest();
}

void UQrRuntimeWidget::ApplySelectionFromMarkdown(const FString& Markdown)
{
	int32 MusicIndex = 0;
	TArray<FString> Lines;
	Markdown.ParseIntoArrayLines(Lines);

	const FString Selection = QrSelection.TrimStartAndEnd().ToLower();
	for (const FString& Line : Lines)
	{
		if (!Line.StartsWith(TEXT("🎵 ")))
		{
			continue;
		}

		bool bMatches = false;
		if (!Selection.IsEmpty())
		{
			bMatches = Line.ToLower().Contains(Selection);
			const int32 LinkStart = Line.Find(TEXT("]("));
			if (LinkStart != INDEX_NONE)
			{
				FString Url = Line.Mid(LinkStart + 2);
				const int32 LinkEnd = Url.Find(TEXT(")"));
				if (LinkEnd != INDEX_NONE)
				{
					Url = Url.Left(LinkEnd);
				}
				FString Suffix = FPaths::GetCleanFilename(Url);
				bMatches = bMatches || Suffix.ToLower() == Selection;
			}
		}

		if (Selection.IsEmpty())
		{
			QrIndex = 0;
			break;
		}
		if (bMatches)
		{
			QrIndex = MusicIndex;
			break;
		}

		++MusicIndex;
	}
}

FString UQrRuntimeWidget::SelectSectionFromMarkdown(const FString& Markdown) const
{
	TArray<FString> Lines;
	Markdown.ParseIntoArrayLines(Lines);

	const FString Selection = QrSelection.TrimStartAndEnd().ToLower();
	int32 StartIndex = INDEX_NONE;
	int32 HeadingLevel = 0;

	for (int32 i = 0; i < Lines.Num(); ++i)
	{
		FString Line = Lines[i].TrimStartAndEnd();
		int32 CurrentHeadingLevel = 0;
		while (CurrentHeadingLevel < Line.Len() && Line[CurrentHeadingLevel] == TEXT('#'))
		{
			++CurrentHeadingLevel;
		}
		if (CurrentHeadingLevel < 1 || CurrentHeadingLevel > 3 ||
			CurrentHeadingLevel >= Line.Len() || Line[CurrentHeadingLevel] != TEXT(' '))
		{
			continue;
		}

		FString Heading = Line.Mid(CurrentHeadingLevel).TrimStartAndEnd();
		FString Slug = Heading.ToLower();
		Slug = Slug.Replace(TEXT(" "), TEXT(""));

		if (Heading.ToLower().Contains(Selection) || Slug.Contains(Selection))
		{
			StartIndex = i;
			HeadingLevel = CurrentHeadingLevel;
			break;
		}
	}

	if (StartIndex == INDEX_NONE)
	{
		return FString();
	}

	TArray<FString> Section;
	for (int32 i = StartIndex; i < Lines.Num(); ++i)
	{
		if (i > StartIndex)
		{
			FString NextLine = Lines[i].TrimStartAndEnd();
			int32 NextLevel = 0;
			while (NextLevel < NextLine.Len() && NextLine[NextLevel] == TEXT('#'))
			{
				++NextLevel;
			}
			if (NextLevel >= 1 && NextLevel <= 3 &&
				NextLevel < NextLine.Len() && NextLine[NextLevel] == TEXT(' ') &&
				NextLevel <= HeadingLevel)
			{
				break;
			}
		}
		Section.Add(Lines[i]);
	}

	return FString::Join(Section, TEXT("\n"));
}
