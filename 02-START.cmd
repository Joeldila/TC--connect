@echo off
setlocal
cd /d "%~dp0"
title TC Connect - Keep this window open
where node >nul 2>nul
if errorlevel 1 goto failed
node scripts/check-local.mjs
if errorlevel 1 goto failed
node --env-file-if-exists=.env.local scripts/local-start.mjs
if errorlevel 1 goto failed
exit /b
:failed
echo.
echo TC Connect did not start. Read the error above.
echo If this is your first run, double-click 01-FIRST-RUN.cmd.
pause
exit /b 1
