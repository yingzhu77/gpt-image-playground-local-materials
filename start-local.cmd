@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install Node.js 22 or later first.
    pause
    exit /b 1
)

node "scripts\start-local.mjs"
if errorlevel 1 pause
