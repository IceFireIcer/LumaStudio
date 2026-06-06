@echo off
title Luma Studio
echo.
echo   ============================================
echo      Luma Studio  v1.0.0
echo      Photo Viewer ^& Lightroom-style Editor
echo   ============================================
echo.

REM === Check Node.js ===
where node >nul 2>nul
if errorlevel 1 (
    echo   [!] Node.js not found
    echo.
    echo   Trying to install Node.js automatically ^(needs internet^)...
    echo   If it fails, download manually from https://nodejs.org/
    echo.

    where winget >nul 2>nul
    if not errorlevel 1 (
        echo   [i] winget detected, installing Node.js LTS...
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements >nul 2>nul
        if not errorlevel 1 (
            echo   [OK] Node.js installed. Please close and reopen this window.
            pause
            exit /b 0
        )
    )

    where choco >nul 2>nul
    if not errorlevel 1 (
        echo   [i] Chocolatey detected, installing Node.js LTS...
        choco install nodejs-lts -y >nul 2>nul
        if not errorlevel 1 (
            echo   [OK] Node.js installed. Please close and reopen this window.
            pause
            exit /b 0
        )
    )

    echo   [X] Auto-install failed. Please install Node.js 18+ manually.
    echo   Download: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo   [OK] Node.js ready:
node -v
echo.

REM === First run: install dependencies ===
if not exist "node_modules" (
    echo   [i] First run, installing dependencies...
    npm install --omit=dev --no-audit --no-fund 2>&1
    if errorlevel 1 (
        echo   [X] Dependency install failed. Check your network.
        pause
        exit /b 1
    )
    echo   [OK] Dependencies installed.
    echo.
)

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
