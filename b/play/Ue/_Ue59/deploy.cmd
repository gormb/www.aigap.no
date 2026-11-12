@md c:\p\UE_5.9b 2>nul
set "SRC=N:\ue59\s"
set "DEST=C:\p\UE_5.9b"
::Rationale: Copy Win64 binaries needed for running the engine (only newer files).
:: rd /s Engine
set "OPT=/E /XO /R:1 /W:1 /NFL /NDL /NJH /NP /XF *.pdb *.ipch *.ilk *.iobj *.ipdb *.obj *.exp *.map *.tlog *.VC.db"

::Rationale: Copy engine binaries for the platform
robocopy "%SRC%\Engine\Binaries\Win64" "%DEST%\Engine\Binaries\Win64" %OPT%

::Rationale: Copy engine binaries for DotNET
robocopy "%SRC%\Engine\Binaries\DotNET" "%DEST%\Engine\Binaries\DotNET" %OPT%

::Rationale: Copy engine binaries for ThirdParty (skip other platforms)
robocopy "%SRC%\Engine\Binaries\ThirdParty" "%DEST%\Engine\Binaries\ThirdParty" %OPT% /XD Linux Mac IOS Android

::Rationale: Copy engine build files
robocopy "%SRC%\Engine\Build" "%DEST%\Engine\Build" %OPT%

::Rationale: Copy engine config files
robocopy "%SRC%\Engine\Config" "%DEST%\Engine\Config" %OPT%

::Rationale: Copy engine content files
robocopy "%SRC%\Engine\Content" "%DEST%\Engine\Content" %OPT%

::Rationale: Copy engine plugins
robocopy "%SRC%\Engine\Plugins" "%DEST%\Engine\Plugins" %OPT%

::Rationale: Copy engine shaders
robocopy "%SRC%\Engine\Shaders" "%DEST%\Engine\Shaders" %OPT%

::Rationale: Copy engine source files
robocopy "%SRC%\Engine\Source" "%DEST%\Engine\Source" %OPT%

pause