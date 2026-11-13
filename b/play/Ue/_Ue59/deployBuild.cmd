@echo off
if not exist "N:\emsdk" git clone https://github.com N:\emsdk
cd /d N:\emsdk
::call emsdk.bat install 6.0.10
::call emsdk.bat activate 6.0.10 --permanent

cd /d N:\ue59\s
::call GenerateProjectFiles.bat

if not exist "C:\ue59_int" md "C:\ue59_int"
if exist "N:\ue59\s\Engine\Intermediate" (
    fsutil reparsepoint query "N:\ue59\s\Engine\Intermediate" >nul 2>&1
    if errorlevel 1 (
        robocopy "N:\ue59\s\Engine\Intermediate" "C:\ue59_int" /E /MOVE /MT:16
        rd /s /q "N:\ue59\s\Engine\Intermediate"
    )
)
if not exist "N:\ue59\s\Engine\Intermediate" (
    mklink /J "N:\ue59\s\Engine\Intermediate" "C:\ue59_int"
)

call Engine\Build\BatchFiles\Build.bat UnrealEditor Win64 Development -WaitMutex
