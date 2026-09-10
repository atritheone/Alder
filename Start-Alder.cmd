@echo off
setlocal
cd /d "%~dp0"
if exist "release\win-unpacked\Alder.exe" (
    start "" "release\win-unpacked\Alder.exe"
    exit /b 0
)
if exist "node_modules\electron\dist\electron.exe" if exist "dist-electron\main.cjs" (
    start "" "node_modules\electron\dist\electron.exe" .
    exit /b 0
)
echo Alder has not been built in this checkout. Use the complete Alder release folder for the self-contained application.
pause
