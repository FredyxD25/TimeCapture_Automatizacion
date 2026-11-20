@echo off
REM Abre el planificador en el navegador (http://127.0.0.1:5000). Deja esta ventana abierta mientras lo usas.
cd /d "%~dp0"
if not exist "web\dist\index.html" (
    echo Compilando la interfaz por primera vez...
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
    pushd web
    call npm install --no-fund --no-audit
    call npm run build
    popd
)
set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" -c "import flask" 2>nul || "%PY%" -m pip install flask pywin32
"%PY%" servidor.py
pause
