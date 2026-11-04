@echo off
setlocal
cd /d "%~dp0"
title TC Connect - First installation
where node >nul 2>nul
if errorlevel 1 goto missingnode
node -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required.');process.exit(1)}"
if errorlevel 1 goto missingnode
if not exist logs mkdir logs
echo.
echo TC CONNECT - FIRST INSTALLATION
echo.
echo Step 1 of 3: Installing dependencies. Internet is needed.
echo This can take a few minutes. Details are saved in logs\install.log
call npm ci --no-audit --no-fund > logs\install.log 2>&1
if errorlevel 1 goto installfailed
echo Step 2 of 3: Building the interface.
call npm run build > logs\build.log 2>&1
if errorlevel 1 goto buildfailed
echo Step 3 of 3: Checking the installed application.
node scripts/check-local.mjs
if errorlevel 1 goto checkfailed
echo.
echo Installation complete. Starting TC Connect...
call 02-START.cmd
exit /b
:missingnode
echo Install Node.js 24 or newer from https://nodejs.org/en/download
echo After installing Node, close this window and run this file again.
pause
exit /b 1
:installfailed
echo Installation failed. Check your internet connection.
echo Open logs\install.log to read the exact error.
pause
exit /b 1
:buildfailed
echo The interface could not be built. Open logs\build.log for the exact error.
pause
exit /b 1
:checkfailed
echo The application check failed. Read the message above.
pause
exit /b 1
