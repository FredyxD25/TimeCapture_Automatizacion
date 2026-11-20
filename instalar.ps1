<#
  Instala todo lo necesario para el proyecto TimeCapture_Automatizacion SIN permisos de administrador.
  Todo queda en la carpeta del usuario (%LOCALAPPDATA%\Programs) y en el PATH del usuario.

    1. Python 3.12            (instalador oficial en modo "solo para mí")
    2. Librerías de Python    (pywin32, flask, pywebview)
    3. Node.js LTS            (zip portable oficial, con verificación SHA-256)
    4. Interfaz web           (npm install + npm run build)
    5. Acceso directo         ("Planificador Outlook" en el escritorio)

  Se puede ejecutar varias veces: lo que ya está instalado se salta.
  Uso: doble clic en "Instalar.bat"  (o: powershell -ExecutionPolicy Bypass -File instalar.ps1)
#>

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # descargas mucho más rápidas en Windows PowerShell 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Proyecto     = $PSScriptRoot
$Planificador = Join-Path $Proyecto "planificador"
$Web          = Join-Path $Planificador "web"
$Programas    = Join-Path $env:LOCALAPPDATA "Programs"
$Descargas    = Join-Path $env:TEMP "instalar_timecapture"

$PythonVersion = "3.12.10"
$PythonExe     = Join-Path $Programas "Python\Python312\python.exe"
$PythonwExe    = Join-Path $Programas "Python\Python312\pythonw.exe"
$NodeVersion   = "v26.13.1"
$NodeDir       = Join-Path $Programas "nodejs"
$Librerias     = @("pywin32", "flask", "pywebview")

function Paso($texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }
function Ok($texto)   { Write-Host "    OK  $texto" -ForegroundColor Green }
function Aviso($texto){ Write-Host "    !!  $texto" -ForegroundColor Yellow }

function Agregar-PathUsuario($carpeta) {
    $actual = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $actual) { $actual = "" }
    if (($actual -split ";") -notcontains $carpeta) {
        [Environment]::SetEnvironmentVariable("Path", ($actual.TrimEnd(";") + ";" + $carpeta).TrimStart(";"), "User")
        Ok "Agregado al PATH del usuario: $carpeta"
    }
    if (($env:Path -split ";") -notcontains $carpeta) { $env:Path = "$carpeta;$env:Path" }
}

New-Item -ItemType Directory -Force $Descargas | Out-Null

# ---------------------------------------------------------------- 1. Python
Paso "Python $PythonVersion"
if (Test-Path $PythonExe) {
    Ok "Ya está instalado: $PythonExe"
} else {
    $instalador = Join-Path $Descargas "python-$PythonVersion-amd64.exe"
    Write-Host "    Descargando desde python.org..."
    Invoke-WebRequest -UseBasicParsing "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe" -OutFile $instalador
    $firma = Get-AuthenticodeSignature $instalador
    if ($firma.Status -ne "Valid" -or $firma.SignerCertificate.Subject -notmatch "Python Software Foundation") {
        throw "La firma del instalador de Python no es válida ($($firma.Status)). No se instala."
    }
    Ok "Firma verificada: Python Software Foundation"
    Write-Host "    Instalando solo para este usuario (sin administrador)..."
    $p = Start-Process $instalador -Wait -PassThru -ArgumentList @(
        "/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_test=0", "Include_launcher=0", "Shortcuts=0")
    if ($p.ExitCode -ne 0 -or -not (Test-Path $PythonExe)) { throw "La instalación de Python falló (código $($p.ExitCode))." }
    Ok "Python instalado en $PythonExe"
}

# ---------------------------------------------------------------- 2. Librerías
Paso "Librerías de Python: $($Librerias -join ', ')"
# Python está instalado en la carpeta del usuario, así que pip puede escribir ahí sin administrador
& $PythonExe -m pip install --upgrade --disable-pip-version-check --quiet @Librerias
if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar las librerías de Python." }
& $PythonExe -c "import win32com.client, flask, webview; print('    OK  pywin32, flask y pywebview importan bien')"
if ($LASTEXITCODE -ne 0) { throw "Las librerías se instalaron pero no cargan." }

# ---------------------------------------------------------------- 3. Node.js
Paso "Node.js $NodeVersion"
if (Test-Path (Join-Path $NodeDir "node.exe")) {
    Ok "Ya está instalado: $NodeDir ($(& (Join-Path $NodeDir 'node.exe') --version))"
} else {
    $zip = Join-Path $Descargas "node-$NodeVersion-win-x64.zip"
    Write-Host "    Descargando zip portable desde nodejs.org..."
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $zip
    $sumas = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt").Content
    $esperado = (($sumas -split "`n" | Where-Object { $_ -match "node-$NodeVersion-win-x64\.zip$" }) -split "\s+")[0]
    $real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if (-not $esperado -or $esperado -ne $real) { throw "El SHA-256 de Node.js no coincide. No se instala." }
    Ok "SHA-256 verificado"
    $temporal = Join-Path $Descargas "node_extraido"
    if (Test-Path $temporal) { Remove-Item -Recurse -Force $temporal }
    Expand-Archive $zip -DestinationPath $temporal -Force
    New-Item -ItemType Directory -Force $Programas | Out-Null
    Move-Item (Join-Path $temporal "node-$NodeVersion-win-x64") $NodeDir
    Ok "Node.js instalado en $NodeDir"
}
Agregar-PathUsuario $NodeDir

# ---------------------------------------------------------------- 4. Interfaz web
Paso "Interfaz web (npm install + build)"
Push-Location $Web
try {
    & (Join-Path $NodeDir "npm.cmd") install --no-fund --no-audit --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw "npm install falló." }
    & (Join-Path $NodeDir "npm.cmd") run build --silent
    if ($LASTEXITCODE -ne 0) { throw "npm run build falló." }
} finally {
    Pop-Location
}
if (-not (Test-Path (Join-Path $Web "dist\index.html"))) { throw "No se generó la interfaz (web\dist)." }
Ok "Interfaz compilada en planificador\web\dist"

# ---------------------------------------------------------------- 5. Acceso directo
Paso "Acceso directo en el escritorio"
$escritorio = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $escritorio "Planificador Outlook.lnk"
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $PythonwExe
$s.Arguments = "`"$(Join-Path $Planificador 'app_escritorio.pyw')`""
$s.WorkingDirectory = $Planificador
$s.IconLocation = "$(Join-Path $Planificador 'icono\icono.ico'),0"   # logo de Time Capture
$s.Description = "Planificador Outlook y Time Capture"
$s.Save()
Ok "Creado: $lnk"

# ---------------------------------------------------------------- Comprobaciones finales
Paso "Comprobaciones"
$webview2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if (-not $webview2) { $webview2 = Get-ItemProperty "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue }
if ($webview2) { Ok "Microsoft Edge WebView2 $($webview2.pv)" }
else { Aviso "No se encontró WebView2 (necesario para la ventana de escritorio). Usa 'Abrir planificador.bat' para abrirlo en el navegador." }

$outlook = Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\Outlook.Application\CurVer" -ErrorAction SilentlyContinue
if ($outlook) { Ok "Outlook clásico disponible ($($outlook.'(default)'))" }
else { Aviso "No se encontró Outlook clásico. El planificador necesita Outlook de escritorio (no el 'Nuevo Outlook')." }

Remove-Item -Recurse -Force $Descargas -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Listo. Abre 'Planificador Outlook' desde el escritorio." -ForegroundColor Green
Write-Host "Si abriste una terminal antes de instalar, ciérrala y ábrela de nuevo para que tome el PATH nuevo."
