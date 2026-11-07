@echo off
rem Restore the original Claude Desktop files and remove this patch.
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js 18 or newer is required.
    pause
    exit /b 1
)

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

node bin\claude-zh.js restore --kill
set "RESULT=%errorlevel%"
echo.
if %RESULT% equ 0 echo The original Claude Desktop files have been restored.
pause
exit /b %RESULT%
