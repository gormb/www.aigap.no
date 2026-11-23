#include "QrRuntimeWidget.h"

#include "Components/Border.h"
#include "Components/Image.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/SlateWrapperTypes.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBoxSlot.h"
#include "Blueprint/WidgetTree.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Engine/Texture2D.h"
#include "TextureResource.h"
#include "Modules/ModuleManager.h"
#include "Misc/DateTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

namespace
{
	// U+1F3B5 (musical note) as a UTF-16 surrogate pair: avoids any dependence on the source file's encoding.
	bool IsMusicMarkerAt(const FString& Line, int32 Index)
	{
		return Index + 1 < Line.Len()
			&& static_cast<uint16>(Line[Index]) == 0xD83C
			&& static_cast<uint16>(Line[Index + 1]) == 0xDFB5;
	}

	// True for a line shaped like m.html's music entries: "<note> [Title](url)".
	bool IsMusicLine(const FString& Line)
	{
		return Line.Len() > 3 && IsMusicMarkerAt(Line, 0)
			&& Line[2] == TEXT(' ') && Line[3] == TEXT('[');
	}

	bool ParseMusicLine(const FString& Line, FString& OutTitle, FString& OutUrl)
	{
		if (!IsMusicLine(Line))
		{
			return false;
		}

		const int32 LabelEnd = Line.Find(TEXT("]("), ESearchCase::CaseSensitive, ESearchDir::FromStart, 3);
		if (LabelEnd == INDEX_NONE)
		{
			return false;
		}

		OutTitle = Line.Mid(4, LabelEnd - 4);
		const int32 UrlStart = LabelEnd + 2;
		const int32 UrlEnd = Line.Find(TEXT(")"), ESearchCase::CaseSensitive, ESearchDir::FromStart, UrlStart);
		OutUrl = UrlEnd == INDEX_NONE ? Line.Mid(UrlStart) : Line.Mid(UrlStart, UrlEnd - UrlStart);
		return true;
	}

	// Mirrors m.html's slug: lowercased with every non-alphanumeric character removed.
	FString NormalizeSlug(const FString& Text)
	{
		FString Result;
		Result.Reserve(Text.Len());
		for (const TCHAR Character : Text)
		{
			if (FChar::IsAlnum(Character))
			{
				Result.AppendChar(FChar::ToLower(Character));
			}
		}
		return Result;
	}

	// The atlas and markdown are regenerated daily, so every request must bypass caches.
	void AddNoCacheHeaders(const TSharedRef<IHttpRequest, ESPMode::ThreadSafe>& Request)
	{
		Request->SetHeader(TEXT("Cache-Control"), TEXT("no-cache, no-store, must-revalidate"));
		Request->SetHeader(TEXT("Pragma"), TEXT("no-cache"));
	}

	FString WithCacheBust(const FString& Url)
	{
		return FString::Printf(TEXT("%s?v=%lld"), *Url, FDateTime::UtcNow().GetTicks());
	}
}

void UQrRuntimeWidget::NativeConstruct()
{
	Super::NativeConstruct();

	EnsureWidgetBindings();

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

		// AddToViewport finalizes the viewport slot after NativeConstruct, so re-pin the layout then.
		World->GetTimerManager().SetTimer(
			LayoutTimerHandle,
			this,
			&UQrRuntimeWidget::ApplyLayout,
			0.1f,
			false);
	}
}

void UQrRuntimeWidget::NativeDestruct()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(RefreshTimerHandle);
		World->GetTimerManager().ClearTimer(LayoutTimerHandle);
	}

	Super::NativeDestruct();
}

void UQrRuntimeWidget::RefreshQr()
{
	FetchImage();
	FetchText();
	++FetchCounter;
}

void UQrRuntimeWidget::SetQrSelection(const FString& Selection)
{
	QrSelection = Selection;
	RefreshQr();
}

void UQrRuntimeWidget::ApplyLayout()
{
	// AddToViewport stretches its content across the screen, so pin the panel to the top-left at a fixed size.
	SetAnchorsInViewport(FAnchors(0.0f, 0.0f));
	SetAlignmentInViewport(FVector2D(0.0f, 0.0f));
	SetPositionInViewport(FVector2D(0.0f, 0.0f), false);
	SetDesiredSizeInViewport(PanelSize);

	if (QrSizeBox)
	{
		QrSizeBox->SetWidthOverride(static_cast<float>(PanelSize.X));
		QrSizeBox->SetHeightOverride(static_cast<float>(PanelSize.Y));
	}

	// The code must be exactly as high as it is wide, never stretched into a row.
	if (QrTileBox)
	{
		QrTileBox->SetWidthOverride(QrDisplaySize);
		QrTileBox->SetHeightOverride(QrDisplaySize);
		if (UVerticalBoxSlot* TileSlot = Cast<UVerticalBoxSlot>(QrTileBox->Slot))
		{
			TileSlot->SetSize(FSlateChildSize(ESlateSizeRule::Automatic));
			TileSlot->SetHorizontalAlignment(HAlign_Left);
			TileSlot->SetVerticalAlignment(VAlign_Top);
		}
	}

	// A white quiet zone around the code, or no scanner can lock onto it.
	if (QrQuietZone)
	{
		QrQuietZone->SetBrushColor(FLinearColor::White);
		QrQuietZone->SetPadding(FMargin(QuietZonePad));
		if (UVerticalBoxSlot* QuietSlot = Cast<UVerticalBoxSlot>(QrQuietZone->Slot))
		{
			QuietSlot->SetSize(FSlateChildSize(ESlateSizeRule::Automatic));
			QuietSlot->SetHorizontalAlignment(HAlign_Left);
			QuietSlot->SetVerticalAlignment(VAlign_Top);
		}
	}

	if (QrImage)
	{
		QrImage->SetDesiredSizeOverride(FVector2D(QrDisplaySize, QrDisplaySize));
	}
}

void UQrRuntimeWidget::EnsureWidgetBindings()
{
	if (!QrImage)
	{
		QrImage = Cast<UImage>(GetWidgetFromName(TEXT("QrImage")));
	}
	if (!QrText)
	{
		QrText = Cast<UTextBlock>(GetWidgetFromName(TEXT("QrText")));
	}
	if (!QrSizeBox)
	{
		QrSizeBox = Cast<USizeBox>(GetWidgetFromName(TEXT("QrSizeBox")));
	}
	if (!QrTileBox)
	{
		QrTileBox = Cast<USizeBox>(GetWidgetFromName(TEXT("QrTileBox")));
	}
	if (!QrQuietZone)
	{
		QrQuietZone = Cast<UBorder>(GetWidgetFromName(TEXT("QrQuietZone")));
	}

	ApplyLayout();

	if (QrImage && QrText)
	{
		QrText->SetAutoWrapText(true);
		return;
	}

	if (!WidgetTree)
	{
		return;
	}

	UOverlay* RootOverlay = Cast<UOverlay>(WidgetTree->RootWidget);
	if (!RootOverlay)
	{
		RootOverlay = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("QrOverlay"));
		WidgetTree->RootWidget = RootOverlay;
	}

	if (!QrImage)
	{
		QrImage = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass(), TEXT("QrImage"));
		if (UOverlaySlot* ImageSlot = RootOverlay->AddChildToOverlay(QrImage))
		{
			ImageSlot->SetHorizontalAlignment(HAlign_Left);
			ImageSlot->SetVerticalAlignment(VAlign_Top);
			ImageSlot->SetPadding(FMargin(24.0f, 24.0f, 0.0f, 0.0f));
		}
	}

	if (!QrText)
	{
		QrText = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("QrText"));
		QrText->SetAutoWrapText(true);
		QrText->SetText(FText::FromString(TEXT("Loading QR data...")));
		if (UOverlaySlot* TextSlot = RootOverlay->AddChildToOverlay(QrText))
		{
			TextSlot->SetHorizontalAlignment(HAlign_Left);
			TextSlot->SetVerticalAlignment(VAlign_Top);
			TextSlot->SetPadding(FMargin(132.0f, 24.0f, 24.0f, 24.0f));
		}
	}
}

void UQrRuntimeWidget::FetchImage()
{
	FString Url = BaseUrl;
	if (!Url.EndsWith(TEXT("/")))
	{
		Url += TEXT("/");
	}
	Url += WithCacheBust(TEXT("m.png"));

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
		FHttpModule::Get().CreateRequest();
	Request->SetURL(Url);
	Request->SetVerb(TEXT("GET"));
	AddNoCacheHeaders(Request);
	Request->OnProcessRequestComplete().BindLambda(
		[this](FHttpRequestPtr HttpRequest, FHttpResponsePtr HttpResponse, bool bSucceeded)
		{
			if (!bSucceeded || !HttpResponse.IsValid() || HttpResponse->GetResponseCode() != 200)
			{
				UE_LOG(LogTemp, Warning, TEXT("QR image download failed"));
				return;
			}

			CachedAtlasPng = HttpResponse->GetContent();
			DisplayQrTile(CachedAtlasPng);
		});
	Request->ProcessRequest();
}

void UQrRuntimeWidget::DisplayQrTile(const TArray<uint8>& PngData)
{
	if (!QrImage || PngData.IsEmpty())
	{
		UE_LOG(LogTemp, Warning, TEXT("QR tile display skipped: image widget or PNG data is missing"));
		return;
	}

	IImageWrapperModule& ImageWrapperModule =
		FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
	TSharedPtr<IImageWrapper> PngWrapper = ImageWrapperModule.CreateImageWrapper(EImageFormat::PNG);
	if (!PngWrapper.IsValid() || !PngWrapper->SetCompressed(PngData.GetData(), PngData.Num()))
	{
		UE_LOG(LogTemp, Warning, TEXT("QR PNG could not be decoded"));
		return;
	}

	constexpr int32 TileWidth = 21;
	constexpr int32 TileHeight = 21;
	const int32 AtlasWidth = PngWrapper->GetWidth();
	const int32 AtlasHeight = PngWrapper->GetHeight();
	const int32 TileCount = AtlasWidth / TileWidth;
	if (AtlasHeight != TileHeight || AtlasWidth % TileWidth != 0 || TileCount <= 0)
	{
		UE_LOG(LogTemp, Warning, TEXT("Unexpected QR PNG dimensions: %dx%d (expected a strip of 21x21 tiles)"),
			AtlasWidth, AtlasHeight);
		return;
	}

	TArray<uint8> AtlasPixels;
	if (!PngWrapper->GetRaw(ERGBFormat::BGRA, 8, AtlasPixels))
	{
		UE_LOG(LogTemp, Warning, TEXT("QR PNG pixel data could not be decoded"));
		return;
	}

	// The atlas can lag the markdown by a day, so clamp rather than wrap to the wrong code.
	const int32 TileIndex = FMath::Clamp(QrIndex, 0, TileCount - 1);
	const int32 TileOffsetX = TileIndex * TileWidth;
	TArray<FColor> TilePixels;
	TilePixels.SetNumUninitialized(TileWidth * TileHeight);
	for (int32 Y = 0; Y < TileHeight; ++Y)
	{
		const uint8* SourceRow = AtlasPixels.GetData() + (Y * AtlasWidth + TileOffsetX) * sizeof(FColor);
		FMemory::Memcpy(TilePixels.GetData() + Y * TileWidth, SourceRow,
			TileWidth * sizeof(FColor));
	}

	CurrentQrTexture = UTexture2D::CreateTransient(TileWidth, TileHeight, PF_B8G8R8A8);
	if (!CurrentQrTexture)
	{
		UE_LOG(LogTemp, Warning, TEXT("Could not create runtime QR texture"));
		return;
	}
	CurrentQrTexture->SRGB = true;
	CurrentQrTexture->NeverStream = true;
	// Nearest sampling keeps the 21x21 modules crisp at the exact 4x (84 px) display size.
	CurrentQrTexture->Filter = TF_Nearest;
	CurrentQrTexture->AddressX = TA_Clamp;
	CurrentQrTexture->AddressY = TA_Clamp;
	FTexture2DMipMap& Mip = CurrentQrTexture->GetPlatformData()->Mips[0];
	void* TextureData = Mip.BulkData.Lock(LOCK_READ_WRITE);
	FMemory::Memcpy(TextureData, TilePixels.GetData(), TilePixels.Num() * sizeof(FColor));
	Mip.BulkData.Unlock();
	CurrentQrTexture->UpdateResource();
	QrImage->SetBrushFromTexture(CurrentQrTexture, true);
	QrImage->SetDesiredSizeOverride(FVector2D(QrDisplaySize, QrDisplaySize));

	UE_LOG(LogTemp, Display, TEXT("Displayed QR tile %d of %d from %dx%d PNG"),
		TileIndex, TileCount, AtlasWidth, AtlasHeight);
}

void UQrRuntimeWidget::FetchText()
{
	FString Url = BaseUrl;
	if (!Url.EndsWith(TEXT("/")))
	{
		Url += TEXT("/");
	}
	Url += WithCacheBust(TEXT("m.md"));

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
		FHttpModule::Get().CreateRequest();
	Request->SetURL(Url);
	Request->SetVerb(TEXT("GET"));
	AddNoCacheHeaders(Request);
	Request->OnProcessRequestComplete().BindLambda(
		[this](FHttpRequestPtr HttpRequest, FHttpResponsePtr HttpResponse, bool bSucceeded)
		{
			if (!bSucceeded || !HttpResponse.IsValid() || HttpResponse->GetResponseCode() != 200)
			{
				UE_LOG(LogTemp, Warning, TEXT("QR text download failed"));
				return;
			}

			const TArray<uint8>& Content = HttpResponse->GetContent();
			FString Markdown;
			if (Content.Num() > 0)
			{
				// m.md carries no BOM; decode as UTF-8 explicitly so the note marker and Norwegian text survive.
				FUTF8ToTCHAR Converter(reinterpret_cast<const ANSICHAR*>(Content.GetData()), Content.Num());
				Markdown = FString(Converter.Length(), Converter.Get());
			}
			ApplySelectionFromMarkdown(Markdown);

			if (QrText)
			{
				// Book scope: the whole markdown is shown; the selection only drives the QR tile.
				QrText->SetText(FText::FromString(FormatMarkdownForDisplay(Markdown)));
			}
			if (!CachedAtlasPng.IsEmpty())
			{
				DisplayQrTile(CachedAtlasPng);
			}
		});
	Request->ProcessRequest();
}

void UQrRuntimeWidget::ApplySelectionFromMarkdown(const FString& Markdown)
{
	TArray<FString> Lines;
	Markdown.ParseIntoArrayLines(Lines);

	// Music ordinal per line (-1 for non-music lines), matching m.html's i++ over the note entries.
	TArray<int32> LineOrdinal;
	LineOrdinal.SetNumUninitialized(Lines.Num());
	int32 MusicCount = 0;
	for (int32 Index = 0; Index < Lines.Num(); ++Index)
	{
		LineOrdinal[Index] = IsMusicLine(Lines[Index]) ? MusicCount++ : INDEX_NONE;
	}

	QrIndex = 0;

	const FString Selection = QrSelection.TrimStartAndEnd();
	if (Selection.IsEmpty())
	{
		return;
	}
	const FString SelectionLower = Selection.ToLower();
	const FString SelectionSlug = NormalizeSlug(Selection);

	// 1) A music entry matched by its label or by its URL tail (https://aigap.no/<tail>).
	for (int32 Index = 0; Index < Lines.Num(); ++Index)
	{
		if (LineOrdinal[Index] == INDEX_NONE)
		{
			continue;
		}

		FString Title;
		FString Url;
		ParseMusicLine(Lines[Index], Title, Url);

		const bool bMatches = Title.ToLower().Contains(SelectionLower)
			|| FPaths::GetCleanFilename(Url).ToLower() == SelectionLower;
		if (bMatches)
		{
			QrIndex = LineOrdinal[Index];
			return;
		}
	}

	// 2) Otherwise treat the selection as a chapter/section heading and use its first music entry.
	int32 SectionStart = INDEX_NONE;
	for (int32 Index = 0; Index < Lines.Num(); ++Index)
	{
		const FString Line = Lines[Index].TrimStartAndEnd();
		int32 Level = 0;
		while (Level < Line.Len() && Line[Level] == TEXT('#'))
		{
			++Level;
		}
		// Page markers ("#### p. N") are anchors, not selectable headings.
		if (Level < 1 || Level > 3 || Level >= Line.Len() || Line[Level] != TEXT(' '))
		{
			continue;
		}

		const FString Heading = Line.Mid(Level).TrimStartAndEnd();
		if (NormalizeSlug(Heading) == SelectionSlug || Heading.ToLower().Contains(SelectionLower))
		{
			SectionStart = Index;
			break;
		}
	}

	if (SectionStart != INDEX_NONE)
	{
		for (int32 Index = SectionStart; Index < Lines.Num(); ++Index)
		{
			if (LineOrdinal[Index] != INDEX_NONE)
			{
				QrIndex = LineOrdinal[Index];
				return;
			}
		}
	}
}

FString UQrRuntimeWidget::FormatMarkdownForDisplay(const FString& Markdown) const
{
	TArray<FString> Lines;
	Markdown.ParseIntoArrayLines(Lines);

	TArray<FString> DisplayLines;
	for (FString Line : Lines)
	{
		Line = Line.TrimStartAndEnd();
		if (Line.IsEmpty())
		{
			if (DisplayLines.Num() > 0 && !DisplayLines.Last().IsEmpty())
			{
				DisplayLines.Add(FString());
			}
			continue;
		}

		int32 HeadingLevel = 0;
		while (HeadingLevel < Line.Len() && Line[HeadingLevel] == TEXT('#'))
		{
			++HeadingLevel;
		}
		if (HeadingLevel > 0 && HeadingLevel < Line.Len() && Line[HeadingLevel] == TEXT(' '))
		{
			Line = Line.Mid(HeadingLevel).TrimStartAndEnd();
		}

		FString MusicTitle;
		FString MusicUrl;
		if (ParseMusicLine(Line, MusicTitle, MusicUrl))
		{
			Line = MusicTitle;
		}
		else if (Line.StartsWith(TEXT("[")))
		{
			const int32 LabelEnd = Line.Find(TEXT("]("));
			if (LabelEnd != INDEX_NONE)
			{
				Line = Line.Mid(1, LabelEnd - 1);
			}
		}

		Line.ReplaceInline(TEXT("**"), TEXT(""));
		Line.ReplaceInline(TEXT("__"), TEXT(""));
		Line.ReplaceInline(TEXT("`"), TEXT(""));
		DisplayLines.Add(Line);
	}

	while (DisplayLines.Num() > 0 && DisplayLines.Last().IsEmpty())
	{
		DisplayLines.Pop();
	}
	return FString::Join(DisplayLines, TEXT("\n"));
}

FString UQrRuntimeWidget::SelectSectionFromMarkdown(const FString& Markdown) const
{
	TArray<FString> Lines;
	Markdown.ParseIntoArrayLines(Lines);

	const FString Selection = QrSelection.TrimStartAndEnd();
	const FString SelectionLower = Selection.ToLower();
	const FString SelectionSlug = NormalizeSlug(Selection);
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
		// Page markers ("#### p. N") are anchors, not selectable headings.
		if (CurrentHeadingLevel < 1 || CurrentHeadingLevel > 3 ||
			CurrentHeadingLevel >= Line.Len() || Line[CurrentHeadingLevel] != TEXT(' '))
		{
			continue;
		}

		FString Heading = Line.Mid(CurrentHeadingLevel).TrimStartAndEnd();
		FString Slug = NormalizeSlug(Heading);

		if (Heading.ToLower().Contains(SelectionLower) ||
			Slug == SelectionSlug)
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
			if (NextLevel >= 1 && NextLevel <= 4 &&
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
