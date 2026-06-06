@echo off
title Uninstall Luma Studio
echo.
echo   Uninstall Luma Studio
echo.
set "INSTALL_DIR=%LOCALAPPDATA%\LumaStudio"

echo   Install location: %INSTALL_DIR%
echo.
echo   [!] Uninstall removes program files and the shortcut.
echo   [!] Your photo data ^(storage folder^) is kept; delete it manually if needed.
echo.
set /p "CONFIRM=Confirm uninstall? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo   Cancelled.
    pause
    exit /b 0
)

REM Remove desktop shortcut
del /f "%USERPROFILE%\Desktop\Luma Studio.lnk" >nul 2>&1

REM Remove program files (keep storage)
del /f "%INSTALL_DIR%\server.js" >nul 2>&1
del /f "%INSTALL_DIR%\package.json" >nul 2>&1
del /f "%INSTALL_DIR%\package-lock.json" >nul 2>&1
del /f "%INSTALL_DIR%\start.bat" >nul 2>&1
rmdir /s /q "%INSTALL_DIR%\public" >nul 2>&1
rmdir /s /q "%INSTALL_DIR%\node_modules" >nul 2>&1

echo.
echo   [OK] Luma Studio uninstalled.
echo   [i] Photo data kept at: %INSTALL_DIR%\storage\
echo   [i] To fully clean up, manually delete: %INSTALL_DIR%
echo.
pause
