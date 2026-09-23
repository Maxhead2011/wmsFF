@echo off
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Setup-Agent.ps1"
if errorlevel 1 (
  echo.
  echo LOGOFF setup could not start. The error is shown above.
  echo Send a photo of this window to technical support.
  pause
)
