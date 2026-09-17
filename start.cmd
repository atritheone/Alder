@echo off
setlocal
cd /d "%~dp0"
node "%~dp0scripts\start-testing.mjs" %*
if errorlevel 1 (
    echo.
    echo Alder was not launched. Fix the error above and run start.cmd again.
    pause
    exit /b 1
)
