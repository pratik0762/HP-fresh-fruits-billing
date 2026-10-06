@echo off
title HP Fresh Fruits - Backend
echo Starting HP Fresh Fruits ERP Backend (Node/Express) on http://localhost:5000 ...
cd /d "%~dp0backend"
start "HP Fresh Fruits - Backend" cmd /k "npm run dev"
timeout /t 3 /nobreak >nul

echo Opening Backend DB Admin UI in Chrome...
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5000/db-admin
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" http://localhost:5000/db-admin
) else (
    start http://localhost:5000/db-admin
)
