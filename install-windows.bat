@echo off
rem Claude Desktop zh patch - Windows launcher.
rem Keep this file ASCII-only; all Chinese text lives in scripts\windows.ps1 (UTF-8 with BOM).
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows.ps1"
echo.
pause
