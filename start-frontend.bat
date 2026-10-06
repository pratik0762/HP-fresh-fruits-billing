@echo off
title HP Fresh Fruits - Frontend
echo Starting HP Fresh Fruits ERP Frontend (Vite) on http://localhost:5173 ...
cd /d "%~dp0frontend"
start "HP Fresh Fruits - Frontend" cmd /k "npm run dev -- --host"
timeout /t 3 /nobreak >nul

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5173
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" http://localhost:5173
) else (
    start http://localhost:5173
)
