@echo off
@md c:\p\UE_5.9b 2>nul
set "SRC=N:\ue59\s"
set "DEST=C:\p\UE_5.9b"
:: 
rd /s "%DEST%\Engine"

set "OPT=/E /XO /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP /XF *.pdb *.ipch *.ilk *.iobj *.ipdb *.obj *.exp *.map *.tlog *.VC.db"

:: 1. Core Binaries (Win64, Wasm, DotNET, ThirdParty)
robocopy "%SRC%\Engine\Binaries\Win64" "%DEST%\Engine\Binaries\Win64" %OPT%
if exist "%SRC%\Engine\Binaries\Wasm" robocopy "%SRC%\Engine\Binaries\Wasm" "%DEST%\Engine\Binaries\Wasm" %OPT%
robocopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET" %OPT%
robocopy "%SRC%\Engine\Binaries\ThirdParty" "%DEST%\Engine\Binaries\ThirdParty" %OPT% /XD Linux LinuxArm64 Mac IOS Android TVOS

:: 2. Wasm Platform Toolchain, Binaries & Templates
robocopy "%SRC%\Engine\Platforms\Wasm" "%DEST%\Engine\Platforms\Wasm" %OPT% /XD Intermediate

:: 3. Core Runtime Data, Programs & Extras
robocopy "%SRC%\Engine\Build" "%DEST%\Engine\Build" %OPT%
robocopy "%SRC%\Engine\Config" "%DEST%\Engine\Config" %OPT%
robocopy "%SRC%\Engine\Content" "%DEST%\Engine\Content" %OPT%
robocopy "%SRC%\Engine\Shaders" "%DEST%\Engine\Shaders" %OPT%
robocopy "%SRC%\Engine\Programs" "%DEST%\Engine\Programs" %OPT% /XD Intermediate
robocopy "%SRC%\Engine\Extras" "%DEST%\Engine\Extras" %OPT% /XD Android IOS Linux Mac

:: 4. All Engine Plugins (Skip .obj files, keep generated headers & binaries)
robocopy "%SRC%\Engine\Plugins" "%DEST%\Engine\Plugins" %OPT%

:: 5. Precompiled BuildRules & Generated UHT Headers (CRITICAL for C++ projects)
robocopy "%SRC%\Engine\Intermediate\Build\BuildRules" "%DEST%\Engine\Intermediate\Build\BuildRules" %OPT%
robocopy "%SRC%\Engine\Intermediate\Build\Win64\UnrealEditor\Inc" "%DEST%\Engine\Intermediate\Build\Win64\UnrealEditor\Inc" %OPT%
if exist "%SRC%\Engine\Intermediate\Build\Wasm" robocopy "%SRC%\Engine\Intermediate\Build\Wasm" "%DEST%\Engine\Intermediate\Build\Wasm" %OPT% *.h *.a *.bc

:: 6. Source Headers, ThirdParty Libs & Build Rules
robocopy "%SRC%\Engine\Source" "%DEST%\Engine\Source" %OPT% /XD Programs

:: 7. Mark as Installed Build & Register with Windows
type nul > "%DEST%\Engine\Build\InstalledBuild.txt"
if exist "%DEST%\Engine\Binaries\Win64\UnrealVersionSelector-Win64-Shipping.exe" (
    "%DEST%\Engine\Binaries\Win64\UnrealVersionSelector-Win64-Shipping.exe" /register
)

pause
