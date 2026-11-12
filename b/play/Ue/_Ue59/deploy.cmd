@md c:\p\UE_5.9b 2>nul
set "SRC=N:\ue59\s"
set "DEST=C:\p\UE_5.9b"
::Rationale: Copy Win64 binaries needed for running the engine (only newer files).
:: rd /s Engine
robocopy "%SRC%\Engine\Binaries\Win64" "%DEST%\Engine\Binaries\Win64" /E /XF *.pdb /XO
xcopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET\" /S /I /D
robocopy "%SRC%\Engine\Binaries\ThirdParty" "%DEST%\Engine\Binaries\ThirdParty" /E /XF *.pdb /XD Linux Mac IOS Android /XO

::Rationale: Copy engine binaries for DotNET
::xcopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET\" /S /I /Y
::Rationale: Copy engine binaries for ThirdParty
::xcopy "%SRC%\Engine\Binaries\ThirdParty" "%DEST%\Engine\Binaries\ThirdParty\" /S /I /Y
::Rationale: Copy engine build files
::xcopy "%SRC%\Engine\Build" "%DEST%\Engine\Build\" /S /I /Y
::Rationale: Copy engine config files
::xcopy "%SRC%\Engine\Config" "%DEST%\Engine\Config\" /S /I /Y
::Rationale: Copy engine content files
::xcopy "%SRC%\Engine\Content" "%DEST%\Engine\Content\" /S /I /Y
::Rationale: Copy engine plugins
::xcopy "%SRC%\Engine\Plugins" "%DEST%\Engine\Plugins\" /S /I /Y
::Rationale: Copy engine shaders
::xcopy "%SRC%\Engine\Shaders" "%DEST%\Engine\Shaders\" /S /I /Y
::Rationale: Copy engine source files
::xcopy "%SRC%\Engine\Source" "%DEST%\Engine\Source\" /S /I /Y
pause
