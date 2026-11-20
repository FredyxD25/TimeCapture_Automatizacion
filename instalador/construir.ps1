<#
  Genera el instalador:  salida\Instalar_PlanificadorOutlook.exe
  (un solo .exe para subir a GitHub > Releases).

  Pasos: compila la interfaz web, arma el paquete con solo lo necesario, lo comprime
  y lo mete dentro del .exe compilado con csc.exe (viene con Windows, no hay que instalar nada).

  Por defecto NO incluye tus datos personales (catálogo de tareas, etiquetas aprendidas,
  respaldos, registros): cada persona arma su propio catálogo desde la aplicación.
    -IncluirMiCatalogo   incluye planificador\catalogo.json (por ejemplo, para compañeros del mismo equipo)
    -SinCompilarWeb      usa la carpeta web\dist que ya existe

  Uso:  powershell -ExecutionPolicy Bypass -File instalador\construir.ps1
#>
param([switch]$IncluirMiCatalogo, [switch]$SinCompilarWeb)

$ErrorActionPreference = "Stop"
$Instalador = $PSScriptRoot
$Proyecto   = Split-Path -Parent $Instalador
$Web        = Join-Path $Proyecto "planificador\web"
$Salida     = Join-Path $Proyecto "salida"
$Paquete    = Join-Path $env:TEMP "paquete_planificador_outlook"
$Zip        = Join-Path $env:TEMP "app_planificador_outlook.zip"
$Exe        = Join-Path $Salida "Instalar_PlanificadorOutlook.exe"
$Framework  = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"

function Paso($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. Interfaz web
if (-not $SinCompilarWeb) {
    Paso "Compilando la interfaz web"
    $npm = Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.cmd"
    if (-not (Test-Path $npm)) { $npm = "npm.cmd" }
    Push-Location $Web
    try {
        & $npm run build --silent
        if ($LASTEXITCODE -ne 0) { throw "npm run build falló." }
    } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $Web "dist\index.html"))) { throw "Falta planificador\web\dist (compila la interfaz)." }

# ---------------------------------------------------------------- 2. Paquete (solo lo necesario)
Paso "Armando el paquete"
if (Test-Path $Paquete) { Remove-Item -Recurse -Force $Paquete }
$archivos = @(
    "time_capture.py",
    "festivos.py",
    "planificador\servidor.py",
    "planificador\tc_api.py",
    "planificador\etiquetas.py",
    "planificador\app_escritorio.pyw",
    "planificador\reglas_etiquetas.json",
    "planificador\Abrir planificador.bat",
    "planificador\icono\icono.ico",
    "planificador\icono\logo.png",
    "instalador\instalar_app.ps1",
    "instalador\desinstalar.ps1"
)
if ($IncluirMiCatalogo) { $archivos += "planificador\catalogo.json" }
foreach ($a in $archivos) {
    $origen = Join-Path $Proyecto $a
    if (-not (Test-Path $origen)) { throw "Falta el archivo: $a" }
    $dest = Join-Path $Paquete $a
    New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
    Copy-Item $origen $dest
}
Copy-Item (Join-Path $Web "dist") (Join-Path $Paquete "planificador\web\dist") -Recurse

# Windows PowerShell 5.1 necesita UTF-8 con BOM para leer bien las tildes de los scripts
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
Get-ChildItem $Paquete -Recurse -Filter *.ps1 | ForEach-Object {
    [IO.File]::WriteAllText($_.FullName, [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8), $utf8Bom)
}

$n = (Get-ChildItem $Paquete -Recurse -File).Count
Write-Host "    $n archivos$(if ($IncluirMiCatalogo) { ' (con tu catálogo)' } else { ' (sin datos personales)' })"

# ---------------------------------------------------------------- 3. Comprimir
Paso "Comprimiendo"
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $Zip) { Remove-Item -Force $Zip }
[IO.Compression.ZipFile]::CreateFromDirectory($Paquete, $Zip, [IO.Compression.CompressionLevel]::Optimal, $false)

# ---------------------------------------------------------------- 4. Compilar el .exe
Paso "Compilando el instalador"
New-Item -ItemType Directory -Force $Salida | Out-Null
$csc = Join-Path $Framework "csc.exe"
& $csc /nologo /target:exe /platform:anycpu /optimize+ `
    "/out:$Exe" `
    "/win32icon:$(Join-Path $Proyecto 'planificador\icono\icono.ico')" `
    "/win32manifest:$(Join-Path $Instalador 'app.manifest')" `
    "/resource:$Zip,app.zip" `
    "/reference:$(Join-Path $Framework 'System.IO.Compression.dll')" `
    "/reference:$(Join-Path $Framework 'System.IO.Compression.FileSystem.dll')" `
    (Join-Path $Instalador "Instalador.cs")
if ($LASTEXITCODE -ne 0) { throw "csc.exe no pudo compilar el instalador." }

Remove-Item -Recurse -Force $Paquete, $Zip -ErrorAction SilentlyContinue
$hash = (Get-FileHash $Exe -Algorithm SHA256).Hash
Write-Host ""
Write-Host "Listo: $Exe  ($([math]::Round((Get-Item $Exe).Length / 1KB)) KB)" -ForegroundColor Green
Write-Host "SHA-256: $hash"
