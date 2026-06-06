@echo off
title Install Luma Studio (Offline)
echo.
echo   ============================================
echo      Install Luma Studio (Offline Edition)
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

REM Copy entire app
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
echo   [i] Copying files (offline package includes all dependencies)...
xcopy /E /I /Y /Q "%~dp0server.js" "%INSTALL_DIR%\" >nul
xcopy /E /I /Y /Q "%~dp0package.json" "%INSTALL_DIR%\" >nul
xcopy /E /I /Y /Q "%~dp0package-lock.json" "%INSTALL_DIR%\" >nul
xcopy /E /I /Y /Q /S "%~dp0public" "%INSTALL_DIR%\public\" >nul
xcopy /E /I /Y /Q /S "%~dp0node_modules" "%INSTALL_DIR%\node_modules\" >nul
if not exist "%INSTALL_DIR%\storage" mkdir "%INSTALL_DIR%\storage"

REM Copy offline start script
copy /Y "%~dp0start-offline.bat" "%INSTALL_DIR%\start.bat" >nul

echo   [OK] Files copied (no npm install needed - offline mode)
echo.

REM Create desktop shortcut
echo   [i] Creating desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Luma Studio.lnk')); $s.TargetPath = '%INSTALL_DIR%\start.bat'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Luma Studio (Offline)'; $s.Save()" >nul 2>&1

echo.
echo   ============================================
echo            Installation complete!
echo     Desktop shortcut "Luma Studio" created.
echo     Double-click it to start; browser opens automatically.
echo   ============================================
echo.
echo   Install location: %INSTALL_DIR%
echo   Photo storage:    %INSTALL_DIR%\storage\uploads\
echo   Mode:             Offline (no internet needed after install)
echo.
pause
