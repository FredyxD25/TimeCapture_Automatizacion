<#
  Lo ejecuta el instalador (.exe) después de copiar la aplicación. No necesita administrador:
    1. Python 3.12            (instalador oficial de python.org, "solo para mí", con verificación de firma)
    2. Librerías de Python    (pywin32, flask, pywebview)
    3. Accesos directos       (escritorio y menú Inicio)
    No escribe en el registro de Windows ni cambia el PATH (los antivirus corporativos lo bloquean);
    para desinstalar: menú Inicio > Planificador Outlook > Desinstalar.
  La interfaz ya viene compilada, así que no hace falta Node.js.
#>
param([Parameter(Mandatory = $true)][string]$Destino, [switch]$SinAccesos)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Version       = "1.0.3"
$Planificador  = Join-Path $Destino "planificador"
$Programas     = Join-Path $env:LOCALAPPDATA "Programs"
$Descargas     = Join-Path $env:TEMP "instalar_planificador_outlook"
$PythonVersion = "3.12.10"
$PythonExe     = Join-Path $Programas "Python\Python312\python.exe"
$PythonwExe    = Join-Path $Programas "Python\Python312\pythonw.exe"
$Librerias     = @("pywin32==312", "flask==3.1.3", "pywebview==6.2.1")
$Icono         = Join-Path $Planificador "icono\icono.ico"

function Paso($texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }
function Ok($texto)   { Write-Host "    OK  $texto" -ForegroundColor Green }
function Aviso($texto){ Write-Host "    !!  $texto" -ForegroundColor Yellow }

try {
    New-Item -ItemType Directory -Force $Descargas | Out-Null

    # ------------------------------------------------------------ 1. Python
    Paso "Python $PythonVersion"
    if (Test-Path $PythonExe) {
        Ok "Ya está instalado: $PythonExe"
    } else {
        $instalador = Join-Path $Descargas "python-$PythonVersion-amd64.exe"
        Write-Host "    Descargando desde python.org (unos 25 MB)..."
        Invoke-WebRequest -UseBasicParsing "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe" -OutFile $instalador
        $firma = Get-AuthenticodeSignature $instalador
        if ($firma.Status -ne "Valid" -or $firma.SignerCertificate.Subject -notmatch "Python Software Foundation") {
            throw "La firma del instalador de Python no es válida ($($firma.Status)). No se instala."
        }
        Ok "Firma verificada: Python Software Foundation"
        Write-Host "    Instalando solo para este usuario..."
        $p = Start-Process $instalador -Wait -PassThru -ArgumentList @(
            "/quiet", "InstallAllUsers=0", "PrependPath=0", "Include_test=0", "Include_launcher=0", "Shortcuts=0")
        if ($p.ExitCode -ne 0 -or -not (Test-Path $PythonExe)) { throw "La instalación de Python falló (código $($p.ExitCode))." }
        Ok "Python instalado en $PythonExe"
    }

    # ------------------------------------------------------------ 2. Librerías
    Paso "Librerías de Python: $($Librerias -join ', ')"
    & $PythonExe -m pip install --upgrade --disable-pip-version-check --quiet @Librerias
    if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar las librerías de Python." }
    & $PythonExe -c "import win32com.client, flask, webview; print('    OK  pywin32, flask y pywebview cargan bien')"
    if ($LASTEXITCODE -ne 0) { throw "Las librerías se instalaron pero no cargan." }

    if ($SinAccesos) { Aviso "Modo prueba: sin accesos directos"; exit 0 }

    # ------------------------------------------------------------ 3. Accesos directos
    Paso "Accesos directos"
    $sh = New-Object -ComObject WScript.Shell
    $menu = Join-Path ([Environment]::GetFolderPath("Programs")) "Planificador Outlook"
    New-Item -ItemType Directory -Force $menu | Out-Null
    foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath("Desktop")) "Planificador Outlook.lnk"),
                       (Join-Path $menu "Planificador Outlook.lnk"))) {
        $s = $sh.CreateShortcut($lnk)
        $s.TargetPath = $PythonwExe
        $s.Arguments = "`"$(Join-Path $Planificador 'app_escritorio.pyw')`""
        $s.WorkingDirectory = $Planificador
        $s.IconLocation = "$Icono,0"
        $s.Description = "Planificador Outlook y Time Capture"
        $s.Save()
        Ok "Creado: $lnk"
    }
    $desinstalar = Join-Path $Destino "instalador\desinstalar.ps1"
    $s = $sh.CreateShortcut((Join-Path $menu "Desinstalar Planificador Outlook.lnk"))
    $s.TargetPath = "powershell.exe"
    $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$desinstalar`""
    $s.IconLocation = "$Icono,0"
    $s.Save()

    # ------------------------------------------------------------ Comprobaciones
    Paso "Comprobaciones"
    $webview2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
    if (-not $webview2) { $webview2 = Get-ItemProperty "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue }
    if ($webview2) { Ok "Microsoft Edge WebView2 $($webview2.pv)" }
    else { Aviso "No se encontró WebView2 (necesario para la ventana). Descárgalo de microsoft.com o usa 'Abrir planificador.bat'." }

    $outlook = Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\Outlook.Application\CurVer" -ErrorAction SilentlyContinue
    if ($outlook) { Ok "Outlook clásico disponible ($($outlook.'(default)'))" }
    else { Aviso "No se encontró Outlook clásico. La aplicación necesita Outlook de escritorio (no el 'Nuevo Outlook')." }

    Write-Host ""
    Write-Host "Listo. Abre 'Planificador Outlook' desde el escritorio o el menú Inicio." -ForegroundColor Green
    Write-Host "Planificador Outlook $Version - por FredyxD25 · https://github.com/FredyxD25/TimeCapture_Automatizacion"
    exit 0
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item -Recurse -Force $Descargas -ErrorAction SilentlyContinue
}
