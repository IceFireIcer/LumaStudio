@echo off
title Luma Studio (Offline)
echo.
echo   ============================================
echo      Luma Studio  v1.0.2  (Offline Edition)
echo      Photo Viewer ^& Lightroom-style Editor
echo   ============================================
echo.

REM === Check Node.js ===
where node >nul 2>nul
if errorlevel 1 (
    echo   [!] Node.js not found
    echo.
    echo   This offline package still requires Node.js runtime installed.
    echo   Download from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo   [OK] Node.js ready:
node -v
echo.

REM === Check node_modules (offline package integrity) ===
if not exist "%~dp0node_modules" (
    echo   [X] node_modules folder missing!
    echo   [X] This offline package appears corrupted or incomplete.
    echo   [X] Please re-download and extract the full offline ZIP.
    echo.
    pause
    exit /b 1
)

echo   [OK] Dependencies present (offline mode)
echo.

REM === Start server ===
echo   [i] Starting Luma Studio...
echo   [i] Browser will open http://localhost:3000
echo   [i] Closing this window stops the server.
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000"

node server.js

echo.
echo   [i] Server stopped.
pause
