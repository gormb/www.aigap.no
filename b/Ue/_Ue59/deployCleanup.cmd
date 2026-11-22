rmdir "N:\ue59\s\Engine\Intermediate" 2>nul
robocopy "C:\ue59_int" "N:\ue59\s\Engine\Intermediate" /E /XO /MT:16 /R:3 /W:2
if %ERRORLEVEL% LSS 8 (
    rd /s /q "C:\ue59_int"
    echo Move completed cleanly.
) else (
    echo Copy interrupted or had errors. C:\ue59_int was kept safe - re-run this script to resume.
)