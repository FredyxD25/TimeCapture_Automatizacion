# Planificador Outlook + Time Capture

Aplicación de escritorio para Windows que:

- **Planifica tu semana en Outlook** dentro del horario laboral (L–J 8:00–17:30, V 8:00–17:00, almuerzo de 1 h entre 12:00 y 14:00), respetando las reuniones aceptadas y repartiendo las tareas de tu catálogo (semanales, quincenales, mensuales y de cierre de mes).
- **Sube tus actividades a Time Capture** con su clasificación y etiquetas, verificando el mínimo de 8 h por día, los cruces y los festivos de Colombia.
- **Revisa lo cargado** en Time Capture y permite eliminar lo que se subió por error.
- **Aprende tus etiquetas**: lo que eliges se sugiere la próxima vez para la misma actividad o para una parecida.

Todo se hace con **tu propia sesión de Outlook**: cada persona sube sus actividades con su propia cuenta.

## Instalación (sin administrador)

1. Descarga **`Instalar_PlanificadorOutlook.exe`** desde la sección [Releases](../../releases).
2. Ábrelo. Si Windows muestra *"Windows protegió su PC"*, pulsa **Más información → Ejecutar de todas formas**. Esto pasa porque el instalador no está firmado digitalmente.
3. Espera a que termine. El instalador:
   - copia la aplicación en `%LOCALAPPDATA%\Programs\PlanificadorOutlook`;
   - instala **Python 3.12** solo para tu usuario, si no lo tienes (descargado de python.org, con su firma verificada);
   - instala las librerías `pywin32`, `flask` y `pywebview`;
   - crea los accesos directos **Planificador Outlook** en el escritorio y en el menú Inicio.
4. Abre **Planificador Outlook**.

Necesitas internet durante la instalación.

**Requisitos:** Windows 10/11, **Outlook clásico** (no el "Nuevo Outlook") con tu cuenta abierta y Microsoft Edge WebView2 (ya viene con Windows 11).

**Para actualizar**, ejecuta el instalador de la versión nueva. Tu catálogo, tus reglas, tus etiquetas aprendidas y tus respaldos se conservan.

**Para desinstalar**, ve a *Configuración → Aplicaciones instaladas → Planificador Outlook*, o usa el acceso *Desinstalar Planificador Outlook* del menú Inicio. Antes de borrar, te ofrece guardar tus datos en Documentos.

## Primer uso

1. En **Catálogo de tareas**, agrega tus actividades con su frecuencia y su etiqueta de Outlook.
2. En **Planificador**, elige el rango de fechas, revisa la propuesta y pulsa **Aplicar a Outlook**.
3. En **Time Capture**, verifica las actividades, ajusta las etiquetas y súbelas.
4. En **Revisión**, comprueba lo que quedó cargado.

Nada se escribe en Outlook ni en Time Capture sin que lo confirmes.

## Para desarrolladores

| Carpeta / archivo | Qué es |
|---|---|
| `time_capture.py` | Lógica de Outlook y de la API de Time Capture; también funciona como script de consola |
| `festivos.py` | Festivos de Colombia (Ley Emiliani y Pascua) |
| `planificador/servidor.py`, `tc_api.py`, `etiquetas.py` | Servidor Flask |
| `planificador/app_escritorio.pyw` | Ventana de escritorio (pywebview) |
| `planificador/web/` | Interfaz en React + Vite |
| `instalador/` | Fuente del instalador `.exe` |

**Generar el instalador:** se necesita Node.js para compilar la interfaz; `csc.exe` ya viene con Windows.

```powershell
powershell -ExecutionPolicy Bypass -File instalador\construir.ps1
```

El instalador queda en `salida\Instalar_PlanificadorOutlook.exe`. Por defecto **no incluye datos personales** (catálogo, etiquetas aprendidas, respaldos). Con `-IncluirMiCatalogo` se agrega `planificador\catalogo.json`.

**Instalar desde el código**, como desarrollador: `Instalar.bat`, que también instala Node.js portable y compila la interfaz.
