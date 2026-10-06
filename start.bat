@echo off
title HP Fresh Fruits ERP Launcher
echo ======================================================
echo       HP Fresh Fruits ERP - Starting All Services
echo ======================================================
echo.

cd /d "%~dp0"

REM 1. Check & copy backend .env if missing
if not exist "backend\.env" (
    echo [Setup] Initializing backend\.env from template...
    if exist "backend\.env.example" (
        copy "backend\.env.example" "backend\.env" >nul
    ) else (
        echo PORT=5000 > backend\.env
        echo NODE_ENV=development >> backend\.env
        echo JWT_SECRET=super_secret_jwt_key_hp_fresh_fruits_erp_2026_ledger >> backend\.env
        echo JWT_EXPIRES_IN=7d >> backend\.env
        echo DB_DIALECT=sqlite >> backend\.env
        echo DB_STORAGE=./data/fruit_erp.sqlite >> backend\.env
        echo CLIENT_URL=http://localhost:5173 >> backend\.env
        echo DB_ADMIN_TOKEN=07f5d67ab4c75c5628bf0d058771c455d5fe327410bc3ac5 >> backend\.env
    )
)

REM 2. Check & copy frontend .env if missing
if not exist "frontend\.env" (
    echo [Setup] Initializing frontend\.env from template...
    if exist "frontend\.env.example" (
        copy "frontend\.env.example" "frontend\.env" >nul
    ) else (
        echo VITE_API_URL=http://localhost:5000/api > frontend\.env
    )
)

REM 3. Check if backend dependencies are installed
if not exist "backend\node_modules\" (
    echo [Setup] Installing backend dependencies (first time setup)...
    cd /d "%~dp0backend"
    call npm install
    cd /d "%~dp0"
)

REM 4. Check if frontend dependencies are installed
if not exist "frontend\node_modules\" (
    echo [Setup] Installing frontend dependencies (first time setup)...
    cd /d "%~dp0frontend"
    call npm install
    cd /d "%~dp0"
)

REM 5. Start Backend API Server
echo [1/3] Starting Backend API Server (Port 5000)...
start "HP Fresh Fruits - Backend" cmd /k "cd /d "%~dp0backend" && npm run dev"

REM Wait 3 seconds for backend database to connect & bootstrap
timeout /t 3 /nobreak >nul

REM 6. Start Frontend Web App
echo [2/3] Starting Frontend Web App (Port 5173)...
start "HP Fresh Fruits - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev -- --host"

REM Wait 3 seconds for Vite server
timeout /t 3 /nobreak >nul

REM 7. Open Browser
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
echo.
echo  Default Login:
echo  Email:    owner@hpfruits.com
echo  Password: admin123
echo ======================================================
echo.
timeout /t 5 >nul
