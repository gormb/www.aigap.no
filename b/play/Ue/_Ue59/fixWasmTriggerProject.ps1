[CmdletBinding()]
param(
    [string]$ProjectRoot = 'C:\temp\WasmTrigger'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$sourceRoot = Join-Path $ProjectRoot 'Source'
$moduleRoot = Join-Path $sourceRoot 'WasmTrigger'

$lowercaseSourceDirectory = Get-ChildItem -LiteralPath $ProjectRoot -Directory |
    Where-Object { $_.Name -ceq 'source' } |
    Select-Object -First 1
if ($lowercaseSourceDirectory) {
    $existingSourceRoot = $lowercaseSourceDirectory.FullName
    $temporarySourceRoot = Join-Path $ProjectRoot ('source-renaming-' + [guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $existingSourceRoot -Destination $temporarySourceRoot
    try {
        Move-Item -LiteralPath $temporarySourceRoot -Destination $sourceRoot
    } catch {
        if (Test-Path -LiteralPath $temporarySourceRoot -PathType Container) {
            Move-Item -LiteralPath $temporarySourceRoot -Destination $existingSourceRoot
        }
        throw
    }
}

New-Item -ItemType Directory -Path $moduleRoot -Force | Out-Null

$targetFiles = @(
    'WasmTrigger.Target.cs',
    'WasmTriggerEditor.Target.cs'
)

foreach ($fileName in $targetFiles) {
    $misplacedPath = Join-Path $moduleRoot $fileName
    $correctPath = Join-Path $sourceRoot $fileName

    if (Test-Path -LiteralPath $misplacedPath -PathType Leaf) {
        if (-not (Test-Path -LiteralPath $correctPath -PathType Leaf)) {
            Move-Item -LiteralPath $misplacedPath -Destination $correctPath
            Write-Host "Moved $fileName to Source\"
        } elseif ((Get-FileHash -LiteralPath $misplacedPath).Hash -eq
            (Get-FileHash -LiteralPath $correctPath).Hash) {
            Remove-Item -LiteralPath $misplacedPath
            Write-Host "Removed duplicate $fileName from Source\WasmTrigger\"
        } else {
            throw "Both misplaced and correctly located $fileName exist with different contents. Resolve the duplicate before continuing."
        }
    }
}

$files = @{
    'WasmTrigger.uproject' = @'
{
  "FileVersion": 3,
  "EngineAssociation": "5.9",
  "Category": "",
  "Description": "WasmTrigger",
  "Modules": [
    {
      "Name": "WasmTrigger",
      "Type": "Runtime",
      "LoadingPhase": "Default"
    }
  ]
}
'@
    'Source\WasmTrigger.Target.cs' = @'
using UnrealBuildTool;
using System.Collections.Generic;

public class WasmTriggerTarget : TargetRules
{
    public WasmTriggerTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V8;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;
        ExtraModuleNames.Add("WasmTrigger");
    }
}
'@
    'Source\WasmTriggerEditor.Target.cs' = @'
using UnrealBuildTool;
using System.Collections.Generic;

public class WasmTriggerEditorTarget : TargetRules
{
    public WasmTriggerEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V8;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;
        ExtraModuleNames.Add("WasmTrigger");
    }
}
'@
    'Source\WasmTrigger\WasmTrigger.Build.cs' = @'
using UnrealBuildTool;

public class WasmTrigger : ModuleRules
{
    public WasmTrigger(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore" });
    }
}
'@
    'Source\WasmTrigger\WasmTrigger.cpp' = @'
#include "WasmTrigger.h"
#include "Modules/ModuleManager.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, WasmTrigger, "WasmTrigger");
'@
    'Source\WasmTrigger\WasmTrigger.h' = @'
#pragma once

#include "CoreMinimal.h"
'@
}

$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
foreach ($relativePath in $files.Keys) {
    $path = Join-Path $ProjectRoot $relativePath

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $parent = Split-Path -Parent $path
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        [System.IO.File]::WriteAllText($path, $files[$relativePath], $utf8WithoutBom)
        Write-Host "Created $relativePath"
    }
}

$newline = "`r`n"
foreach ($fileName in $targetFiles) {
    $targetPath = Join-Path $sourceRoot $fileName
    $targetContent = Get-Content -Raw -LiteralPath $targetPath
    $defaultSetting = [regex]::Match(
        $targetContent,
        '([ \t]*)DefaultBuildSettings\s*=\s*BuildSettingsVersion\.V\d+\s*;'
    )
    if (-not $defaultSetting.Success) {
        throw "Could not locate DefaultBuildSettings in $targetPath"
    }

    $indent = $defaultSetting.Groups[1].Value
    $targetContent = [regex]::Replace(
        $targetContent,
        '([ \t]*)DefaultBuildSettings\s*=\s*BuildSettingsVersion\.V\d+\s*;',
        '${1}DefaultBuildSettings = BuildSettingsVersion.V8;',
        1
    )

    if ($targetContent -match 'IncludeOrderVersion\s*=') {
        $targetContent = [regex]::Replace(
            $targetContent,
            '([ \t]*)IncludeOrderVersion\s*=\s*[^;]+;',
            '${1}IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;',
            1
        )
    } else {
        $targetContent = [regex]::Replace(
            $targetContent,
            '([ \t]*DefaultBuildSettings = BuildSettingsVersion\.V8;)',
            ('$1' + $newline + $indent + 'IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_9;'),
            1
        )
    }
    if ($targetContent -match 'CppStandard\s*=') {
        $targetContent = [regex]::Replace(
            $targetContent,
            '([ \t]*)CppStandard\s*=\s*[^;]+;',
            '${1}CppStandard = CppStandardVersion.Cpp20;',
            1
        )
    } else {
        $targetContent = [regex]::Replace(
            $targetContent,
            '([ \t]*IncludeOrderVersion = EngineIncludeOrderVersion\.Unreal5_9;)',
            ('$1' + $newline + $indent + 'CppStandard = CppStandardVersion.Cpp20;'),
            1
        )
    }

    if ($targetContent -ne (Get-Content -Raw -LiteralPath $targetPath)) {
        [System.IO.File]::WriteAllText($targetPath, $targetContent, $utf8WithoutBom)
        Write-Host "Updated UE 5.9 build settings in $fileName"
    }
}

$projectFile = Join-Path $ProjectRoot 'WasmTrigger.uproject'
$project = Get-Content -Raw -LiteralPath $projectFile | ConvertFrom-Json
$modules = @()
if ($project.PSObject.Properties['Modules']) {
    $modules = @($project.Modules)
}
if (-not ($modules | Where-Object { $_.Name -eq 'WasmTrigger' })) {
    $modules += [pscustomobject]@{
        Name = 'WasmTrigger'
        Type = 'Runtime'
        LoadingPhase = 'Default'
    }
    if ($project.PSObject.Properties['Modules']) {
        $project.Modules = $modules
    } else {
        $project | Add-Member -NotePropertyName Modules -NotePropertyValue $modules
    }
    [System.IO.File]::WriteAllText(
        $projectFile,
        ($project | ConvertTo-Json -Depth 100),
        $utf8WithoutBom
    )
    Write-Host 'Added the WasmTrigger runtime module to WasmTrigger.uproject'
}

$moduleSource = Join-Path $moduleRoot 'WasmTrigger.cpp'
$moduleSourceContent = Get-Content -Raw -LiteralPath $moduleSource
if ($moduleSourceContent -notmatch '^\s*#include\s+"WasmTrigger\.h"') {
    $moduleSourceContent = '#include "WasmTrigger.h"' + "`r`n" + $moduleSourceContent.TrimStart()
}
if ($moduleSourceContent -notmatch 'IMPLEMENT_(PRIMARY_)?GAME_MODULE') {
    $moduleSourceContent = $moduleSourceContent.TrimEnd() +
        "`r`n`r`n#include `"Modules/ModuleManager.h`"`r`n" +
        'IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, WasmTrigger, "WasmTrigger");' +
        "`r`n"
    [System.IO.File]::WriteAllText($moduleSource, $moduleSourceContent, $utf8WithoutBom)
    Write-Host 'Added the primary game module implementation to WasmTrigger.cpp'
} elseif ((Get-Content -Raw -LiteralPath $moduleSource) -ne $moduleSourceContent) {
    [System.IO.File]::WriteAllText($moduleSource, $moduleSourceContent, $utf8WithoutBom)
}

Write-Host "Project structure is ready at $ProjectRoot"
