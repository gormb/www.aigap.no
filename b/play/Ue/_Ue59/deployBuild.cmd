if not exist "N:\emsdk" git clone https://github.com N:\emsdk
cd /d N:\emsdk
call emsdk.bat install 6.0.10
call emsdk.bat activate 6.0.10 --permanent
call emsdk_env.bat
call emcc --version
cd /d N:\ue59\s
call GenerateProjectFiles.bat
call Engine\Build\BatchFiles\Build.bat UnrealEditor Win64 Development -WaitMutex
