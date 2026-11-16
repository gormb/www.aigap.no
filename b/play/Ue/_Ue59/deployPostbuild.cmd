@echo off
setlocal EnableExtensions

set "SRC=N:\ue59\s"
set "DEST=C:\p\UE_5.9b"

if not exist "%SRC%\Engine" (
    echo [ERROR] Source not found: %SRC%\Engine
    exit /b 1
)

md "%DEST%" 2>nul
set "OPT=/E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP /XF *.pdb *.ipch *.ilk *.iobj *.ipdb *.obj *.exp *.map *.tlog *.VC.db"

@echo [0/8] Root Repository Files
robocopy "%SRC%" "%DEST%" /LEV:1 /R:1 /W:1 /NFL /NDL /NJH /NP

@echo [1/8] Core Binaries (Win64, Wasm, DotNET, ThirdParty)
robocopy "%SRC%\Engine\Binaries\Win64" "%DEST%\Engine\Binaries\Win64" %OPT%
if exist "%SRC%\Engine\Binaries\Wasm" robocopy "%SRC%\Engine\Binaries\Wasm" "%DEST%\Engine\Binaries\Wasm" %OPT%
robocopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET" %OPT%
robocopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET" /E /XO /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP *.pdb
robocopy "%SRC%\Engine\Binaries\ThirdParty" "%DEST%\Engine\Binaries\ThirdParty" %OPT% /XD Linux LinuxArm64 Mac IOS Android TVOS

@echo [2/8] Wasm Platform Toolchain, Binaries and Templates
if exist "%SRC%\Engine\Platforms\Wasm" robocopy "%SRC%\Engine\Platforms\Wasm" "%DEST%\Engine\Platforms\Wasm" %OPT% /XD Intermediate

@echo [3/8] Core Runtime Data, Programs, Templates and Extras
robocopy "%SRC%\Engine\Build"     "%DEST%\Engine\Build"     %OPT%
robocopy "%SRC%\Engine\Config"    "%DEST%\Engine\Config"    %OPT%
robocopy "%SRC%\Engine\Content"   "%DEST%\Engine\Content"   %OPT%
robocopy "%SRC%\Engine\Shaders"   "%DEST%\Engine\Shaders"   %OPT%
if exist "%SRC%\Templates" (
    robocopy "%SRC%\Templates" "%DEST%\Engine\Templates" %OPT%
) else if exist "%SRC%\Engine\Templates" (
    robocopy "%SRC%\Engine\Templates" "%DEST%\Engine\Templates" %OPT%
)
robocopy "%SRC%\Engine\Programs"  "%DEST%\Engine\Programs"  %OPT% /XD Intermediate obj uatobj
robocopy "%SRC%\Engine\Extras"    "%DEST%\Engine\Extras"    %OPT% /XD Android IOS Linux LinuxArm64 Mac TVOS

@echo [4/8] All Engine Plugins
robocopy "%SRC%\Engine\Plugins" "%DEST%\Engine\Plugins" %OPT% /XD obj uatobj

@echo [5/8] Precompiled BuildRules, Generated UHT Headers, Libs, PCHs, Wasm artifacts
robocopy "%SRC%\Engine\Intermediate\Build\BuildRules" "%DEST%\Engine\Intermediate\Build\BuildRules" %OPT%
robocopy "%SRC%\Engine\Intermediate\Build\Win64" "%DEST%\Engine\Intermediate\Build\Win64" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP *.h *.hpp *.inl *.lib *.pch *.rsp *.def
if exist "%SRC%\Engine\Intermediate\Build\Wasm" (
    robocopy "%SRC%\Engine\Intermediate\Build\Wasm" "%DEST%\Engine\Intermediate\Build\Wasm" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NP *.h *.a *.bc
)

@echo [6/8] Source Headers, ThirdParty Libs and Build Rules (excluding C# obj/uatobj caches)
robocopy "%SRC%\Engine\Source" "%DEST%\Engine\Source" %OPT% /XD obj uatobj

@echo [7/8] Hard Verification Checks
if not exist "%DEST%\Directory.Packages.props" (
    echo [ERROR] Root Directory.Packages.props missing
    exit /b 1
)
if not exist "%DEST%\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.exe" (
    echo [ERROR] Precompiled UnrealBuildTool.exe missing
    exit /b 1
)
if not exist "%DEST%\Engine\Binaries\Win64\UnrealEditor.target" (
    echo [ERROR] UnrealEditor.target receipt missing
    exit /b 1
)

@echo [8/8] Mark as Installed Build and register with Windows
type nul > "%DEST%\Engine\Build\InstalledBuild.txt"

if exist "%DEST%\Engine\Binaries\Win64\UnrealVersionSelector-Win64-Shipping.exe" (
    echo Registering engine with UnrealVersionSelector...
    powershell -NoProfile -Command "Start-Process -FilePath '%DEST%\Engine\Binaries\Win64\UnrealVersionSelector-Win64-Shipping.exe' -ArgumentList '/register' -Verb RunAs -Wait"
)

echo [SUCCESS] Deployment script hardened and complete.
endlocal