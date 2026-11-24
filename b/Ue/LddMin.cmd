@echo off
rem Builds the Wasm Shipping stage, then publishes it: gzip the module, drop the raw one,
rem regenerate index_notest.html. publish_wasm.ps1 is idempotent, so a failed archive can be
rem fixed just by running it again.
"C:\UE_5.9\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun -project="C:\doc\www.aigap.no\b\Ue\LddMin.uproject" -platform=Wasm -clientconfig=Shipping -build -cook -stage -pak -iostore -package -archive -archivedirectory="C:\doc\www.aigap.no\b\Ue\LddMin_Pack" -unattended
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish_wasm.ps1"