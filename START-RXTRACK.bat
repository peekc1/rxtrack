@echo off
title RxTrack Pharmacy System
color 0A
echo.
echo  ==========================================
echo   RxTrack Pharmacy Inventory System
echo  ==========================================
echo.
echo  Starting RxTrack on your local network...
echo  All pharmacy stations can access this app.
echo.

cd /d "%~dp0"

:: Check if Node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  ERROR: Node.js is not installed.
    echo  Please install it from https://nodejs.org
    echo  Choose the LTS version.
    pause
    exit
)

:: Install packages if needed
if not exist "node_modules" (
    echo  First run - installing packages (one time only)...
    npm install
    echo.
)

:: Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set IP=%%a
    goto :found
)
:found
set IP=%IP: =%

echo  ==========================================
echo.
echo   RxTrack is RUNNING!
echo.
echo   Open on THIS computer:
echo   http://localhost:3000
echo.
echo   Open on ANY station/phone on your network:
echo   http://%IP%:3000
echo.
echo   Share the network address with all stations.
echo   Keep this window open while using RxTrack.
echo.
echo  ==========================================
echo.

npm run dev
pause
