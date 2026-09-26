@echo off
REM Kill existing IIS Express
taskkill /F /IM iisexpress.exe 2>nul
timeout /t 3 /nobreak >nul

REM Start IIS Express
cd /d "E:\Fyp Fazooliyaaat\Unified Backend Workspace\WebApplication2"
start "" "C:\Program Files\IIS Express\iisexpress.exe" /path:"E:\Fyp Fazooliyaaat\Unified Backend Workspace\WebApplication2" /port:5050 /trace:false

echo IIS Express starting on port 5050...
timeout /t 5 /nobreak >nul
echo Backend should be ready now.
