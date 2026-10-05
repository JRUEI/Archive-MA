@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:3200
call npm run dev -- -p 3200
pause
