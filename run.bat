@echo off
setlocal enabledelayedexpansion

cls
echo.
echo ====================================
echo   DeepNetSecure - Start Script
echo ====================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

echo OK - Node.js installed
node --version
echo.

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing npm dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed
        pause
        exit /b 1
    )
    echo OK - Dependencies installed
    echo.
)

REM Build frontend
echo Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed
    pause
    exit /b 1
)
echo OK - Frontend built
echo.

REM Create uploads folder
if not exist "backend\uploads" (
    mkdir backend\uploads
)

echo.
echo ====================================
echo Starting Backend Server...
echo ====================================
echo Backend running on: http://localhost:4006
echo.
echo Waiting for server to start...
echo.

REM Start backend in background
start "" node backend/server.js

REM Wait 3 seconds for server to initialize
timeout /t 3 /nobreak

REM Open browser
start http://localhost:4006

echo.
echo Server is running. Press Ctrl+C to stop.
echo.

REM Keep terminal open and listening for Ctrl+C
:wait
timeout /t 1 /nobreak >nul
goto wait
