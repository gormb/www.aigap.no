@echo off
setlocal

if not exist "C:\emsdk\emsdk.bat" (
    git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
)
cd /d C:\emsdk
call emsdk.bat install 6.0.10
call emsdk.bat activate 6.0.10 --permanent

set "EMSDK=C:\emsdk"
set "WASM_EMSDK_ROOT=C:\emsdk"

cd /d N:\ue59

if not exist "C:\ue59_int" md "C:\ue59_int"
if exist "N:\ue59\s\Engine\Intermediate" (
    fsutil reparsepoint query "N:\ue59\s\Engine\Intermediate" >nul 2>&1
    if errorlevel 1 (
        robocopy "N:\ue59\s\Engine\Intermediate" "C:\ue59_int" /E /MOVE /MT:16
        if exist "N:\ue59\s\Engine\Intermediate" rd /s /q "N:\ue59\s\Engine\Intermediate"
    )
)
if not exist "N:\ue59\s\Engine\Intermediate" (
    mklink /J "N:\ue59\s\Engine\Intermediate" "C:\ue59_int"
)

call Engine\Build\BatchFiles\Build.bat LddMin Wasm Development -Project="C:\doc\www.aigap.no\b\play\Ue\LddMin.uproject" -WaitMutex
