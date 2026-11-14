@echo off
REM Menjalankan server Kasir Buket di komputer Windows (uji coba / server di toko).
REM Syarat: Node.js 22 LTS atau lebih baru (https://nodejs.org).
cd /d "%~dp0\..\server"
set PORT=8080
set HOST=0.0.0.0
set DATA_DIR=%~dp0\..\data
set STATIC_DIR=%~dp0\..\app\dist
echo Buka http://localhost:8080 di browser. Dari HP satu WiFi: http://IP-KOMPUTER:8080
node --disable-warning=ExperimentalWarning src\index.js
pause
