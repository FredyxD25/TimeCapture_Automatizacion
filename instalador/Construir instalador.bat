@echo off
REM Genera salida\Instalar_PlanificadorOutlook.exe
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0construir.ps1" %*
pause
