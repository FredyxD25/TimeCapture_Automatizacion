<#
  Desinstala Planificador Outlook: quita los accesos directos
  y la carpeta de la aplicación. Python y sus librerías se dejan (pueden usarlos otros programas).
  Antes pregunta si guardar tus datos (catálogo, etiquetas aprendidas, respaldos) en Documentos.
#>
$ErrorActionPreference = "Continue"
$Destino = Split-Path -Parent $PSScriptRoot
$Planificador = Join-Path $Destino "planificador"

Write-Host "Desinstalar Planificador Outlook (por FredyxD25)" -ForegroundColor White
Write-Host "Carpeta: $Destino"
Write-Host ""
if ((Read-Host "¿Seguro que quieres desinstalarlo? (s/n)") -notmatch "^[sSyY]") { exit 0 }

if ((Read-Host "¿Guardar tus datos (catálogo, etiquetas aprendidas y respaldos) en Documentos? (s/n)") -match "^[sSyY]") {
    $copia = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Planificador Outlook - datos $(Get-Date -Format yyyyMMdd_HHmmss)"
    New-Item -ItemType Directory -Force $copia | Out-Null
    foreach ($n in @("catalogo.json", "reglas_etiquetas.json", "etiquetas_aprendidas.json", "respaldos")) {
        $ruta = Join-Path $Planificador $n
        if (Test-Path $ruta) { Copy-Item $ruta $copia -Recurse -Force }
    }
    Write-Host "Datos guardados en: $copia" -ForegroundColor Green
}

Remove-Item (Join-Path ([Environment]::GetFolderPath("Desktop")) "Planificador Outlook.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath("Programs")) "Planificador Outlook") -Recurse -Force -ErrorAction SilentlyContinue
# Solo limpia la entrada que dejaban las versiones 1.0.0-1.0.2, si existe
$viejo = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PlanificadorOutlook"
if (Test-Path $viejo) { Remove-Item $viejo -Recurse -Force -ErrorAction SilentlyContinue }

Set-Location $env:TEMP
Remove-Item $Destino -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $Destino) {
    Write-Host "No se pudo borrar toda la carpeta (¿la aplicación está abierta?). Ciérrala y borra: $Destino" -ForegroundColor Yellow
} else {
    Write-Host "Planificador Outlook se desinstaló." -ForegroundColor Green
}
Read-Host "Presiona Enter para cerrar"
