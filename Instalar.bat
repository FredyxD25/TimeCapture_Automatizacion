@echo off
REM Instala todo lo necesario para el proyecto sin permisos de administrador.
REM -ExecutionPolicy Bypass aplica solo a esta ejecucion; no cambia la configuracion de Windows.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
echo.
pause
