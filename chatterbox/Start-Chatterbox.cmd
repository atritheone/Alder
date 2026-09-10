@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:7860/' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 }; exit 1 } catch { exit 1 }"
if not errorlevel 1 (
    start "" "http://127.0.0.1:7860"
    exit /b 0
)
"%LOCALAPPDATA%\chatterbox\venv\Scripts\python.exe" local_app.py
pause
