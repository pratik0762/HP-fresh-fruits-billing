@echo off
title HP Fresh Fruits ERP Launcher
echo ======================================================
echo       HP Fresh Fruits ERP - Starting All Services
echo ======================================================
echo.

REM 1. Start Backend in a dedicated window
echo [1/3] Starting Backend API Server (Port 5000)...
start "HP Fresh Fruits - Backend" cmd /k "cd /d "%~dp0backend" && npm run dev"

REM Wait 3 seconds for backend database to connect
timeout /t 3 /nobreak >nul

REM 2. Start Frontend in a dedicated window
echo [2/3] Starting Frontend Web App (Port 5173)...
start "HP Fresh Fruits - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev -- --host"

REM Wait 3 seconds for servers to initialize
timeout /t 3 /nobreak >nul

REM 3. Open Chrome with Frontend ERP and Backend DB Admin UI
echo [3/3] Opening ERP Frontend and Backend DB Admin in Chrome...
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5173 http://localhost:5000/db-admin
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" http://localhost:5173 http://localhost:5000/db-admin
) else (
    start http://localhost:5173
    start http://localhost:5000/db-admin
)

echo.
echo ======================================================
echo  HP Fresh Fruits ERP is now running!
echo  Frontend UI:    http://localhost:5173
echo  Backend DB UI:  http://localhost:5000/db-admin
echo  Backend API:    http://localhost:5000/api
echo ======================================================
echo.
timeout /t 5 >nul
