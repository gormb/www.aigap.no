@echo off
setlocal EnableExtensions

@md c:\p\UE_5.9b 2>nul
set "SRC=N:\ue59\s"
if not exist "%SRC%\Engine" (
    echo [ERROR] Source not found: %SRC%\Engine
    exit /b 1
)
set "DEST=C:\p\UE_5.9b"
set "OPT=/E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP /XF *.pdb *.ipch *.ilk *.iobj *.ipdb *.obj *.exp *.map *.tlog *.VC.db"

@echo 1. Core Binaries (Win64, Wasm, DotNET, ThirdParty)
robocopy "%SRC%\Engine\Binaries\Win64" "%DEST%\Engine\Binaries\Win64" %OPT%
if exist "%SRC%\Engine\Binaries\Wasm" (
    robocopy "%SRC%\Engine\Binaries\Wasm" "%DEST%\Engine\Binaries\Wasm" %OPT%
) else (
    echo [WARN] Wasm binaries not found in source: %SRC%\Engine\Binaries\Wasm
)
robocopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET" %OPT%
robocopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET" /E /XO /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP *.pdb
robocopy "%SRC%\Engine\Binaries\ThirdParty" "%DEST%\Engine\Binaries\ThirdParty" %OPT% /XD Linux LinuxArm64 Mac IOS Android TVOS

@echo 2. Wasm Platform Toolchain, Binaries and Templates
if exist "%SRC%\Engine\Platforms\Wasm" (
    robocopy "%SRC%\Engine\Platforms\Wasm" "%DEST%\Engine\Platforms\Wasm" %OPT% /XD Intermediate
) else (
    echo [WARN] Wasm platform folder not found: %SRC%\Engine\Platforms\Wasm
)

@echo 3. Core Runtime Data, Programs and Extras
robocopy "%SRC%\Engine\Build"    "%DEST%\Engine\Build"    %OPT%
robocopy "%SRC%\Engine\Config"   "%DEST%\Engine\Config"   %OPT%
robocopy "%SRC%\Engine\Content"  "%DEST%\Engine\Content"  %OPT%
robocopy "%SRC%\Engine\Shaders"  "%DEST%\Engine\Shaders"  %OPT%
robocopy "%SRC%\Engine\Programs" "%DEST%\Engine\Programs" %OPT% /XD Intermediate
robocopy "%SRC%\Engine\Extras"   "%DEST%\Engine\Extras"   %OPT% /XD Android IOS Linux LinuxArm64 Mac TVOS

@echo 4. All Engine Plugins
robocopy "%SRC%\Engine\Plugins" "%DEST%\Engine\Plugins" %OPT%

@echo 5. Precompiled BuildRules, Generated UHT Headers, Wasm artifacts
robocopy "%SRC%\Engine\Intermediate\Build\BuildRules" "%DEST%\Engine\Intermediate\Build\BuildRules" %OPT%
robocopy "%SRC%\Engine\Intermediate\Build\Win64\UnrealEditor\Inc" "%DEST%\Engine\Intermediate\Build\Win64\UnrealEditor\Inc" %OPT%
if exist "%SRC%\Engine\Intermediate\Build\Wasm" (
    robocopy "%SRC%\Engine\Intermediate\Build\Wasm" "%DEST%\Engine\Intermediate\Build\Wasm" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP *.h *.a *.bc
    if errorlevel 8 (
        echo [ERROR] robocopy failed for Wasm intermediates
        exit /b 1
    )
) else (
    echo [WARN] Wasm intermediate build folder not found: %SRC%\Engine\Intermediate\Build\Wasm
)

@echo 6. Source Headers, ThirdParty Libs and Build Rules
robocopy "%SRC%\Engine\Source" "%DEST%\Engine\Source" %OPT%
if not exist "%DEST%\Engine\Source\Programs\Shared\UnrealEngine.csproj.props" (
    echo [ERROR] C# tooling props missing - -projectfiles will fail
    exit /b 1
)
if not exist "%DEST%\Engine\Source\Programs\AutomationTool\AutomationTool\AutomationTool.csproj" (
    echo [ERROR] AutomationTool.csproj missing
    exit /b 1
)

@echo 7. Mark as Installed Build and register with Windows
if not exist "%DEST%\Engine\Build" md "%DEST%\Engine\Build" 2>nul
type nul > "%DEST%\Engine\Build\InstalledBuild.txt"

if exist "%DEST%\Engine\Binaries\Win64\UnrealVersionSelector-Win64-Shipping.exe" (
    echo Registering engine with UnrealVersionSelector...
    powershell -NoProfile -Command "Start-Process -FilePath '%DEST%\Engine\Binaries\Win64\UnrealVersionSelector-Win64-Shipping.exe' -ArgumentList '/register' -Verb RunAs -Wait"
) else (
    echo [WARN] UnrealVersionSelector not found; engine will not be auto-registered.
)

@echo 8. Wasm SDK (Emscripten) reminder
echo.
echo [REMINDER] This script does NOT copy the Emscripten SDK (emsdk).
echo            On the target machine, verify:
echo              Editor -^> Platforms -^> SDK Management -^> Wasm
echo            Install/point emsdk to the version required by UE 5.9 (currently 6.0.10).

endlocal