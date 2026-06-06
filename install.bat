@echo off
title Install Luma Studio
echo.
echo   ============================================
echo      Install Luma Studio
echo   ============================================
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\LumaStudio"

REM Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo   [!] Node.js is required first.
    echo   Opening download page...
    start https://nodejs.org/
    echo   Install Node.js then run this script again.
    pause
    exit /b 1
)

echo   [i] Install dir: %INSTALL_DIR%
echo.

REM Copy files
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
echo   [i] Copying files...
xcopy /E /I /Y /Q "%~dp0server.js" "%INSTALL_DIR%\" >nul
xcopy /E /I /Y /Q "%~dp0package.json" "%INSTALL_DIR%\" >nul
xcopy /E /I /Y /Q "%~dp0package-lock.json" "%INSTALL_DIR%\" >nul
xcopy /E /I /Y /Q /S "%~dp0public" "%INSTALL_DIR%\public\" >nul
if not exist "%INSTALL_DIR%\storage" mkdir "%INSTALL_DIR%\storage"

REM Copy start script
copy /Y "%~dp0start.bat" "%INSTALL_DIR%\start.bat" >nul

REM Install dependencies
echo   [i] Installing dependencies ^(first time may take 30s^)...
cd /d "%INSTALL_DIR%"
call npm install --omit=dev --no-audit --no-fund >nul 2>&1
if errorlevel 1 (
    echo   [X] Dependency install failed.
    pause
    exit /b 1
)
echo   [OK] Dependencies installed.

REM Create desktop shortcut
echo   [i] Creating desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Luma Studio.lnk')); $s.TargetPath = '%INSTALL_DIR%\start.bat'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Luma Studio'; $s.Save()" >nul 2>&1

echo.
echo   ============================================
echo            Installation complete!
echo     Desktop shortcut "Luma Studio" created.
echo     Double-click it to start; browser opens automatically.
echo   ============================================
echo.
echo   Install location: %INSTALL_DIR%
echo   Photo storage:    %INSTALL_DIR%\storage\uploads\
echo.
pause
