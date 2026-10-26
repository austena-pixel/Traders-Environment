@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-TIOS-MT5-Bridge.ps1"
set "setup_result=%errorlevel%"
if not "%setup_result%"=="0" (
    echo.
    echo Setup stopped. Follow the message above, then run this file again.
    pause
)
exit /b %setup_result%
