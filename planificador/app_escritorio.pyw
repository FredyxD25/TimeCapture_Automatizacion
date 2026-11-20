"""
Planificador Outlook como aplicación de escritorio: abre la interfaz en una ventana propia
(Edge WebView2) en lugar de una pestaña del navegador. Al cerrar la ventana se detiene todo.

Requisitos: pip install flask pywin32 pywebview
Ejecutar sin consola:  pythonw app_escritorio.pyw   (o el acceso directo del escritorio)
"""

import socket
import threading
import time
import traceback
from pathlib import Path

import webview

BASE = Path(__file__).resolve().parent
REGISTRO = BASE / "app_errores.log"
ICONO = BASE / "icono" / "icono.ico"
TITULO = "Planificador Outlook"
APP_ID = "FredyxD25.PlanificadorOutlook"

try:
    # Identidad propia en la barra de tareas (si no, Windows la agrupa con Python y muestra su ícono)
    import ctypes
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
except Exception:
    pass


def preparar_anclaje():
    """Le dice a Windows cómo volver a abrir la app si se ancla la ventana a la barra de tareas.

    Con una identidad propia (APP_ID) y sin esto, Windows ancla algo que no sabe ejecutar y el
    botón anclado no abre nada. Aquí se fija en la ventana el comando, el nombre y el ícono."""
    import os
    import sys

    import pythoncom
    import win32gui
    import win32process
    from win32com.propsys import propsys

    pythoncom.CoInitialize()
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    comando = f'"{pythonw}" "{Path(__file__).resolve()}"'
    ventanas = []

    def revisar(hwnd, _):
        if win32gui.GetWindowText(hwnd) == TITULO and win32process.GetWindowThreadProcessId(hwnd)[1] == os.getpid():
            ventanas.append(hwnd)

    win32gui.EnumWindows(revisar, None)
    for hwnd in ventanas:
        store = propsys.SHGetPropertyStoreForWindow(hwnd, propsys.IID_IPropertyStore)
        # Primero los datos para relanzar y al final la identidad (Windows los lee juntos)
        for nombre, valor in (
            ("System.AppUserModel.RelaunchCommand", comando),
            ("System.AppUserModel.RelaunchDisplayNameResource", TITULO),
            ("System.AppUserModel.RelaunchIconResource", f"{ICONO},0"),
            ("System.AppUserModel.ID", APP_ID),
        ):
            store.SetValue(propsys.PSGetPropertyKeyFromName(nombre), propsys.PROPVARIANTType(valor))
        store.Commit()
    return len(ventanas)


def puerto_libre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def esperar_servidor(puerto, segundos=15):
    limite = time.time() + segundos
    while time.time() < limite:
        try:
            with socket.create_connection(("127.0.0.1", puerto), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def main():
    import servidor  # noqa: E402  (mismo servidor que usa la versión de navegador)

    if not (servidor.DIST / "index.html").exists():
        webview.create_window("Planificador Outlook", html=(
            "<h3 style='font-family:Segoe UI'>Falta compilar la interfaz</h3>"
            "<p style='font-family:Segoe UI'>Ejecuta una vez <b>Abrir planificador.bat</b> para compilarla.</p>"))
        webview.start()
        return

    puerto = puerto_libre()
    hilo = threading.Thread(
        target=lambda: servidor.app.run(host="127.0.0.1", port=puerto, debug=False, threaded=True),
        daemon=True,  # se cierra junto con la ventana
    )
    hilo.start()
    esperar_servidor(puerto)

    ventana = webview.create_window(
        TITULO,
        f"http://127.0.0.1:{puerto}",
        width=1440,
        height=900,
        min_size=(900, 600),
        confirm_close=False,
    )

    def al_mostrar():
        try:
            preparar_anclaje()
        except Exception:
            # No impide usar la app: solo afecta a volver a abrirla desde un anclaje
            (BASE / "app_anclaje.log").write_text(traceback.format_exc(), encoding="utf-8")

    ventana.events.shown += al_mostrar
    # Sin modo privado, para que la ventana recuerde el rango de fechas entre aperturas.
    # Ícono: el logo de Time Capture (en la ventana y, por el AppUserModelID, en la barra de tareas).
    webview.start(private_mode=False, storage_path=str(BASE / ".datos_ventana"), icon=str(ICONO))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Sin consola no se ven los errores: se guardan en app_errores.log
        REGISTRO.write_text(traceback.format_exc(), encoding="utf-8")
        raise
