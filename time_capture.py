"""
Registra las actividades de tu calendario de Outlook en Time Capture (Eficacia),
usando la misma API que el complemento:

  Citas propias / reuniones que organizas:
    POST /findAppointment          -> ¿ya existe? (uuid)
    POST /data                     -> crear / actualizar
  Reuniones a las que asistes:
    POST /findAppointmentAttendee  -> ¿ya existe? (uuid)
    POST /data/attendee            -> crear / actualizar

Requisitos (Windows, Outlook de escritorio abierto):
    pip install pywin32

Uso:
    python time_capture.py --desde 2026-10-16                 # hasta hoy
    python time_capture.py --desde 2026-10-16 --hasta 2026-10-23
    python time_capture.py --dia hoy
    python time_capture.py                                    # pregunta el rango de fechas
    python time_capture.py --cita                             # cita abierta/seleccionada
    python time_capture.py --desde 2026-10-16 --todo          # subir todo de una (una confirmación)

Flujo:
  1. Verifica el rango: qué ya está registrado, cruces de horario y que cada día laborable
     tenga al menos 8 h (el almuerzo y lo "No productivo" se suben, pero no suman).
  2. Sube (actividad por actividad o todo de una) y vuelve a consultar cada una para confirmarla.
  3. Reporta cuáles se subieron, cuáles no (y por qué) y cuáles se omitieron.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

import pywintypes
import win32com.client

API_BASE = "https://tc.eficacia.com.co:7000/api"

# Clasificación inicial. Después de cada actividad se reutiliza la última que usaste.
DEFAULTS = {
    "pais": "COLOMBIA",
    "gerencia": "Soluciones De Desarrollo Comercial",
    "proceso": "Inteligencia & Analitica Comercial",
    "negocio": "Soluciones De Desarrollo Comercial",
    "cliente": "Colgate Palmolive Compañia",  # varios: "A|B"
}

# Campos del formulario "Corporativo" (UserProperties). Si la cita los trae, tienen prioridad.
CAMPOS_FORMULARIO = {
    "gerencia": "Gerencia",
    "proceso": "Proceso",
    "negocio": "Negocio",
    "cliente": "Cliente",
}

# Actividades que no se proponen (comparación sin mayúsculas, por inicio del asunto)
EXCLUIR_ASUNTOS = ["cancelado:", "canceled:"]
# Categorías de Outlook que no se proponen
EXCLUIR_CATEGORIAS = []

# Horas mínimas por día laborable. El almuerzo y lo "No productivo" se suben, pero no suman.
HORAS_MINIMAS_DIA = 8
NO_SUMAN_ASUNTOS = ["almuerzo"]
NO_SUMAN_CATEGORIAS = ["no productivo"]

# Festivos de Colombia (no se exigen 8 h): se calculan para cualquier año en festivos.py
from festivos import FESTIVOS  # noqa: E402

DIAS_SEMANA = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]

PAISES = ["COLOMBIA", "ECUADOR", "PERÚ", "REGIÓN"]

# Constantes de Outlook
OL_FOLDER_CALENDAR = 9
OL_REQUIRED = 1
OL_RESPONSE_ACCEPTED = 3
OL_RESPONSE_DECLINED = 4
OL_MEETING_RECEIVED = 3
OL_MEETING_RECEIVED_CANCELED = 7
OL_MEETING_CANCELED = 5
OL_APPOINTMENT_CLASS = 26
OL_MEETING_CLASSES = {53, 54, 55, 56, 57}
PR_SMTP_ADDRESS = "http://schemas.microsoft.com/mapi/proptag/0x39FE001E"


# --------------------------------------------------------------------------- API

def api_get(ruta):
    with urllib.request.urlopen(f"{API_BASE}{ruta}", timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def api_post(ruta, datos):
    cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}{ruta}",
        data=cuerpo,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')}") from e


class Catalogos:
    """Listas de Time Capture, cargadas una sola vez."""

    def __init__(self):
        print("Cargando listas de Time Capture...")
        self.gerencias = api_get("/gerencia")  # [{id, homologado}]
        self.negocios = api_get("/negocio")
        self.clientes = api_get("/clients")
        self._procesos = {}

    def id_gerencia(self, nombre):
        return next((g["id"] for g in self.gerencias if g["homologado"] == nombre), None)

    def procesos(self, gerencia):
        gid = self.id_gerencia(gerencia)
        if gid not in self._procesos:
            self._procesos[gid] = api_get(f"/proceso?gerencia={gid}" if gid else "/proceso")
        return self._procesos[gid]

    def errores(self, c):
        e = []
        if c["pais"] not in PAISES:
            e.append(f"País '{c['pais']}' no válido")
        if self.id_gerencia(c["gerencia"]) is None:
            e.append(f"Gerencia '{c['gerencia']}' no existe")
        elif c["proceso"] not in self.procesos(c["gerencia"]):
            e.append(f"Proceso '{c['proceso']}' no existe para esa gerencia")
        if c["negocio"] not in self.negocios:
            e.append(f"Negocio '{c['negocio']}' no existe")
        for cli in c["cliente"].split("|"):
            if cli not in self.clientes:
                e.append(f"Cliente '{cli}' no existe")
        return e


# ------------------------------------------------------------ Entrada por consola

def elegir(titulo, opciones, actual):
    """Lista numerada; Enter conserva el valor actual."""
    print(f"\n{titulo} (actual: {actual})")
    for i, op in enumerate(opciones, 1):
        print(f"  {i:>3}. {op}")
    while True:
        r = input("Número (Enter = mantener): ").strip()
        if not r:
            return actual
        if r.isdigit() and 1 <= int(r) <= len(opciones):
            return opciones[int(r) - 1]
        print("Opción no válida.")


def elegir_clientes(cat, actual):
    print(f"\nCliente(s) actual(es): {actual}")
    while True:
        termino = input("Buscar cliente (Enter = mantener): ").strip().lower()
        if not termino:
            return actual
        encontrados = [c for c in cat.clientes if termino in c.lower()][:30]
        if not encontrados:
            print("Sin resultados, intenta otra búsqueda.")
            continue
        for i, c in enumerate(encontrados, 1):
            print(f"  {i:>3}. {c}")
        r = input("Números separados por coma (Enter = buscar otra vez): ").strip()
        if not r:
            continue
        try:
            elegidos = [encontrados[int(x) - 1] for x in r.split(",") if x.strip()]
        except (ValueError, IndexError):
            print("Selección no válida.")
            continue
        return "|".join(elegidos)


def editar_clasificacion(cat, c):
    c = dict(c)
    c["pais"] = elegir("País", PAISES, c["pais"])
    nombres_ger = [g["homologado"] for g in cat.gerencias]
    nueva_ger = elegir("Gerencia", nombres_ger, c["gerencia"])
    if nueva_ger != c["gerencia"]:
        c["gerencia"] = nueva_ger
        c["proceso"] = ""
    c["proceso"] = elegir("Proceso", cat.procesos(c["gerencia"]), c["proceso"])
    c["negocio"] = elegir("Negocio", cat.negocios, c["negocio"])
    c["cliente"] = elegir_clientes(cat, c["cliente"])
    return c


# ----------------------------------------------------------------------- Outlook

def smtp_de(address_entry):
    if address_entry is None:
        return ""
    try:
        usuario = address_entry.GetExchangeUser()
        if usuario is not None and usuario.PrimarySmtpAddress:
            return usuario.PrimarySmtpAddress
    except Exception:
        pass
    try:
        return address_entry.PropertyAccessor.GetProperty(PR_SMTP_ADDRESS)
    except Exception:
        return address_entry.Address or ""


def smtp_de_destinatario(destinatario):
    """Correo de un asistente. Lee la propiedad SMTP del destinatario (rápido) y solo si no está
    consulta Exchange (lento: en invitaciones masivas de 1.000+ personas tardaba más de un minuto)."""
    try:
        correo = destinatario.PropertyAccessor.GetProperty(PR_SMTP_ADDRESS)
        if correo:
            return correo
    except Exception:
        pass
    return smtp_de(destinatario.AddressEntry)


def hora_local(valor):
    # pywin32 marca las fechas de Outlook como UTC aunque son hora local
    return valor.replace(tzinfo=None)


def cita_actual(outlook):
    item = None
    try:
        ventana = outlook.ActiveWindow()
        if ventana is not None and ventana.Class == 35:  # olInspector
            item = ventana.CurrentItem
    except Exception:
        pass
    if item is None:
        seleccion = outlook.ActiveExplorer().Selection
        if seleccion.Count > 0:
            item = seleccion.Item(1)
    if item is None:
        return None
    if item.Class in OL_MEETING_CLASSES:
        item = item.GetAssociatedAppointment(False)
    return Actividad(item) if item is not None and item.Class == OL_APPOINTMENT_CLASS else None


class Actividad:
    """Copia en memoria de una cita de Outlook. Se lee una sola vez, así el resto del
    proceso no depende de que Outlook siga abierto o respondiendo."""

    def __init__(self, cita, con_asistentes=True):
        self.Subject = cita.Subject or ""
        self.EntryID = cita.EntryID  # para volver a abrir la cita (p. ej. al cambiarle la etiqueta)
        self.Start = hora_local(cita.Start)
        self.End = hora_local(cita.End)
        self.Categories = cita.Categories or ""
        self.MeetingStatus = cita.MeetingStatus
        self.ResponseStatus = cita.ResponseStatus
        self.organizador = ""
        if self.MeetingStatus == OL_MEETING_RECEIVED:
            try:
                self.organizador = smtp_de(cita.GetOrganizer())
            except Exception:
                pass
        # None = todavía no leídos (en invitaciones masivas es lo más lento; solo se necesitan al subir)
        self.asistentes = None
        if con_asistentes:
            self.leer_asistentes(cita)
        self.formulario = {}
        for campo in CAMPOS_FORMULARIO.values():
            try:
                prop = cita.UserProperties.Find(campo)
                if prop is not None and str(prop.Value).strip():
                    self.formulario[campo] = str(prop.Value).strip()
            except Exception:
                pass

    def leer_asistentes(self, cita):
        self.asistentes = []
        try:
            for r in cita.Recipients:
                try:
                    if r.Type == OL_REQUIRED:
                        self.asistentes.append(smtp_de_destinatario(r).lower())
                except Exception:
                    continue
        except Exception:
            pass


# Nombre de categoría -> color en formato Office.js ("Preset0".."Preset24"; Outlook usa 1..25)
COLORES_CATEGORIAS = {}


def leer_colores_categorias(namespace):
    COLORES_CATEGORIAS.clear()
    for categoria in namespace.Categories:
        color = categoria.Color
        COLORES_CATEGORIAS[categoria.Name] = f"Preset{color - 1}" if color > 0 else "None"


def citas_en_rango(namespace, desde, hasta, con_asistentes=True):
    items = namespace.GetDefaultFolder(OL_FOLDER_CALENDAR).Items
    items.IncludeRecurrences = True
    items.Sort("[Start]")
    # Filtro DASL en UTC (no depende del formato de fecha regional)
    ini = datetime.combine(desde, datetime.min.time()).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), datetime.min.time()).astimezone(timezone.utc)
    filtro = (
        '@SQL="urn:schemas:calendar:dtstart" >= \'{0}\' AND '
        '"urn:schemas:calendar:dtstart" < \'{1}\''
    ).format(ini.strftime("%Y-%m-%d %H:%M"), fin.strftime("%Y-%m-%d %H:%M"))

    citas = []
    for cita in items.Restrict(filtro):
        if not (desde <= hora_local(cita.Start).date() <= hasta):
            continue
        if cita.AllDayEvent:
            continue
        if cita.MeetingStatus in (OL_MEETING_CANCELED, OL_MEETING_RECEIVED_CANCELED):
            continue
        if cita.ResponseStatus == OL_RESPONSE_DECLINED:
            continue
        if (cita.Subject or "").strip().lower().startswith(tuple(EXCLUIR_ASUNTOS)):
            continue
        cats = [c.strip().lower() for c in (cita.Categories or "").replace(";", ",").split(",")]
        if any(c in EXCLUIR_CATEGORIAS for c in cats):
            continue
        citas.append(Actividad(cita, con_asistentes))
    return citas


def es_asistente(cita):
    return cita.MeetingStatus == OL_MEETING_RECEIVED


def sin_aceptar(cita):
    """Reunión recibida que no aceptaste (provisional o sin responder): no bloquea ni suma horas."""
    return es_asistente(cita) and getattr(cita, "ResponseStatus", OL_RESPONSE_ACCEPTED) != OL_RESPONSE_ACCEPTED


def campo_formulario(cita, nombre):
    return cita.formulario.get(nombre, "")


def datos_cita(cita, mi_correo):
    inicio, fin = cita.Start, cita.End
    organizador = cita.organizador if es_asistente(cita) else mi_correo
    asistentes = cita.asistentes or []
    # Mismo formato que el complemento (Office.js): [{"displayName": ..., "color": "PresetN"}]
    categorias = [
        {"displayName": nombre, "color": COLORES_CATEGORIAS.get(nombre, "None")}
        for nombre in (c.strip() for c in (cita.Categories or "").replace(";", ",").split(","))
        if nombre
    ]
    return {
        "title": cita.Subject or "Sin título",
        "sender": (organizador or mi_correo).lower(),
        "attendees": ",".join(asistentes),
        "start_date": inicio.strftime("%Y-%m-%d"),
        "start_time": inicio.strftime("%H:%M:%S"),
        "end_date": fin.strftime("%Y-%m-%d"),
        "end_time": fin.strftime("%H:%M:%S"),
        "categories": json.dumps(categorias, ensure_ascii=False),
        "_inicio": inicio,
        "_fin": fin,
    }


def solapes(citas):
    """Para cada cita, los asuntos de las otras citas del rango que se cruzan en horario."""
    rangos = [(hora_local(c.Start), hora_local(c.End), c.Subject) for c in citas]
    res = []
    for i, (a_ini, a_fin, _) in enumerate(rangos):
        res.append([s for j, (b_ini, b_fin, s) in enumerate(rangos)
                    if j != i and a_ini < b_fin and b_ini < a_fin])
    return res


# -------------------------------------------------------------------- Registro

def buscar_existente(d, asistente, mi_correo):
    clave = {k: d[k] for k in ("title", "sender", "start_date", "end_date", "start_time", "end_time")}
    if asistente:
        clave["asistenteEmail"] = mi_correo
        texto = api_post("/findAppointmentAttendee", clave)
    else:
        texto = api_post("/findAppointment", clave)
    try:
        resultado = json.loads(texto or "{}")
    except json.JSONDecodeError:
        return {}
    return resultado if isinstance(resultado, dict) else {}


def subir(d, c, uuid, asistente, mi_correo, tiempo_asistencia=None):
    payload = {
        "country": c["pais"],
        "client": c["cliente"],
        "gerencia": c["gerencia"],
        "negocio": c["negocio"],
        "proceso": c["proceso"],
        "title": d["title"],
        "sender": d["sender"],
        "attendees": d["attendees"],
        "start_date": d["start_date"],
        "start_time": d["start_time"],
        "end_date": d["end_date"],
        "end_time": d["end_time"],
        "categories": d["categories"],
        "uuid": uuid,
    }
    if asistente:
        payload["asistenteEmail"] = mi_correo
        payload["tiempoAsistencia"] = tiempo_asistencia or f"{d['_inicio']:%H:%M} - {d['_fin']:%H:%M}"
        return api_post("/data/attendee", payload)
    return api_post("/data", payload)


def etiqueta_de(d):
    return f"{d['start_date']} {d['_inicio']:%H:%M}-{d['_fin']:%H:%M}  {d['title']}"


def nuevo_resumen():
    # Cada lista guarda (etiqueta, detalle)
    return {"subidas": [], "no_subidas": [], "omitidas": []}


def subir_y_confirmar(d, c, uuid, asistente, mi_correo, simular):
    """Sube la actividad y luego la vuelve a buscar en Time Capture para confirmar que quedó."""
    if simular:
        return True, "simulación (no se envió)"
    try:
        respuesta = subir(d, c, uuid, asistente, mi_correo)
    except Exception as e:
        return False, f"error al guardar: {e}"
    try:
        confirmada = bool(buscar_existente(d, asistente, mi_correo).get("uuid"))
    except Exception as e:
        return False, f"se envió pero no se pudo verificar: {e}"
    if confirmada:
        return True, "confirmada en Time Capture"
    return False, f"el servidor respondió ({respuesta[:80]}) pero no aparece al verificar"


def procesar(citas, mi_correo, cat, clasif_inicial, simular=False):
    ultima = dict(clasif_inicial)
    cruces = solapes(citas)
    resumen = nuevo_resumen()

    for n, cita in enumerate(citas, 1):
        asistente = es_asistente(cita)
        d = datos_cita(cita, mi_correo)
        etiqueta = etiqueta_de(d)

        # Clasificación propuesta: formulario de la cita > última usada
        c = dict(ultima)
        for clave, campo in CAMPOS_FORMULARIO.items():
            c[clave] = campo_formulario(cita, campo) or c[clave]

        try:
            existente = buscar_existente(d, asistente, mi_correo)
        except Exception as e:
            resumen["no_subidas"].append((etiqueta, f"no se pudo consultar: {e}"))
            continue
        uuid = existente.get("uuid")
        if uuid:
            # Mostrar lo que ya está guardado como propuesta
            ger_id = existente.get("gerencia_id")
            ger = next((g["homologado"] for g in cat.gerencias if str(g["id"]) == str(ger_id)), None)
            c.update({
                "pais": existente.get("country") or c["pais"],
                "cliente": existente.get("client") or c["cliente"],
                "negocio": existente.get("negocio") or c["negocio"],
                "proceso": existente.get("proceso") or c["proceso"],
                "gerencia": ger or c["gerencia"],
            })

        while True:
            print("\n" + "=" * 70)
            print(f"[{n}/{len(citas)}] {etiqueta}")
            print(f"Tipo:     {'Reunión (asistente)' if asistente else 'Actividad propia / organizador'}")
            if cruces[n - 1]:
                print(f"⚠ Se cruza con: {'; '.join(cruces[n - 1])}")
            if not suma_horas(cita):
                print("ℹ Se sube, pero no suma a las horas mínimas del día")
            print(f"Estado:   {'YA REGISTRADA (se actualizaría)' if uuid else 'Pendiente'}")
            print(f"País:     {c['pais']}")
            print(f"Gerencia: {c['gerencia']}")
            print(f"Proceso:  {c['proceso']}")
            print(f"Negocio:  {c['negocio']}")
            print(f"Cliente:  {c['cliente']}")
            errores = cat.errores(c)
            for e in errores:
                print(f"  ✗ {e}")

            op = input("[s] subir  [e] editar  [n] omitir  [q] salir: ").strip().lstrip("﻿").lower()
            if op == "e":
                c = editar_clasificacion(cat, c)
                continue
            if op == "q":
                for resto in citas[n - 1:]:
                    resumen["omitidas"].append((etiqueta_de(datos_cita(resto, mi_correo)), "saliste antes de revisarla"))
                return resumen
            if op != "s":
                resumen["omitidas"].append((etiqueta, "la omitiste"))
                break
            if errores:
                print("Corrige la clasificación (opción e) antes de subir.")
                continue
            ok, detalle = subir_y_confirmar(d, c, uuid, asistente, mi_correo, simular)
            print(("✓ " if ok else "✗ ") + detalle)
            resumen["subidas" if ok else "no_subidas"].append((etiqueta, detalle))
            if ok:
                ultima = dict(c)
            break
    return resumen


def procesar_todo(citas, mi_correo, cat, clasif_inicial, simular=False):
    """Sube todas las actividades pendientes con una misma clasificación, tras una sola confirmación.
    Las que ya están registradas no se tocan."""
    c = dict(clasif_inicial)
    resumen = nuevo_resumen()

    while True:
        print("\nClasificación para TODAS:")
        print(f"  País:     {c['pais']}")
        print(f"  Gerencia: {c['gerencia']}")
        print(f"  Proceso:  {c['proceso']}")
        print(f"  Negocio:  {c['negocio']}")
        print(f"  Cliente:  {c['cliente']}")
        errores = cat.errores(c)
        for e in errores:
            print(f"  ✗ {e}")
        op = input(f"¿Subir las {len(citas)} actividades? [s] sí  [e] editar clasificación  [n] cancelar: ").strip().lstrip("﻿").lower()
        if op == "e":
            c = editar_clasificacion(cat, c)
            continue
        if op != "s":
            for cita in citas:
                resumen["omitidas"].append((etiqueta_de(datos_cita(cita, mi_correo)), "cancelaste la subida"))
            return resumen
        if errores:
            print("Corrige la clasificación (opción e) antes de subir.")
            continue
        break

    for n, cita in enumerate(citas, 1):
        asistente = es_asistente(cita)
        d = datos_cita(cita, mi_correo)
        etiqueta = etiqueta_de(d)
        try:
            if buscar_existente(d, asistente, mi_correo).get("uuid"):
                resumen["omitidas"].append((etiqueta, "ya estaba registrada"))
                print(f"[{n}/{len(citas)}] = Ya registrada: {etiqueta}")
                continue
        except Exception as e:
            resumen["no_subidas"].append((etiqueta, f"no se pudo consultar: {e}"))
            print(f"[{n}/{len(citas)}] ✗ {etiqueta}")
            continue
        ok, detalle = subir_y_confirmar(d, c, None, asistente, mi_correo, simular)
        print(f"[{n}/{len(citas)}] {'✓' if ok else '✗'} {etiqueta}")
        resumen["subidas" if ok else "no_subidas"].append((etiqueta, detalle))
    return resumen


def reparar_etiquetas(citas, mi_correo, cat, simular=False):
    """Para actividades ya registradas cuya etiqueta quedó vacía en Time Capture, vuelve a enviar
    el registro con la etiqueta de Outlook, conservando la clasificación que ya tiene guardada."""
    resumen = nuevo_resumen()
    print("\nRevisando etiquetas en Time Capture...")
    por_corregir = []
    for cita in citas:
        d = datos_cita(cita, mi_correo)
        etiqueta = etiqueta_de(d)
        asistente = es_asistente(cita)
        nombres = [x["displayName"] for x in json.loads(d["categories"])]
        try:
            ex = buscar_existente(d, asistente, mi_correo)
        except Exception as e:
            resumen["no_subidas"].append((etiqueta, f"no se pudo consultar: {e}"))
            continue
        if not ex.get("uuid"):
            resumen["omitidas"].append((etiqueta, "no está registrada (súbela con el modo normal)"))
            continue
        if not nombres:
            resumen["omitidas"].append((etiqueta, "no tiene etiqueta en Outlook"))
            continue
        guardadas = ex.get("categories") or ""
        if all(n in guardadas for n in nombres):
            resumen["omitidas"].append((etiqueta, f"ya tiene la etiqueta ({guardadas})"))
            continue
        por_corregir.append((cita, d, ex, nombres))

    if not por_corregir:
        print("No hay etiquetas por corregir.")
        return resumen

    print(f"\nEtiquetas por corregir: {len(por_corregir)}")
    for _, d, ex, nombres in por_corregir:
        print(f"   {etiqueta_de(d)}  → {', '.join(nombres)}   (guardado: '{ex.get('categories') or ''}')")
    if not simular and not si(input(f"\n¿Corregir las {len(por_corregir)} etiquetas? [s/N]: ")):
        for _, d, _, _ in por_corregir:
            resumen["omitidas"].append((etiqueta_de(d), "cancelaste la corrección"))
        return resumen

    for n, (cita, d, ex, nombres) in enumerate(por_corregir, 1):
        etiqueta = etiqueta_de(d)
        asistente = es_asistente(cita)
        ger = ex.get("gerencia") or next(
            (g["homologado"] for g in cat.gerencias if str(g["id"]) == str(ex.get("gerencia_id"))), "")
        c = {
            "pais": ex.get("country") or "",
            "cliente": ex.get("client") or "",
            "gerencia": ger,
            "negocio": ex.get("negocio") or "",
            "proceso": ex.get("proceso") or "",
        }
        tiempo = None
        if ex.get("entry_time") and ex.get("exit_time"):
            tiempo = f"{ex['entry_time']} - {ex['exit_time']}"
        if simular:
            print(f"[{n}/{len(por_corregir)}] (simulación) {etiqueta}")
            resumen["subidas"].append((etiqueta, f"agregaría: {', '.join(nombres)}"))
            continue
        try:
            subir(d, c, ex["uuid"], asistente, mi_correo, tiempo)
            guardadas = buscar_existente(d, asistente, mi_correo).get("categories") or ""
        except Exception as e:
            print(f"[{n}/{len(por_corregir)}] ✗ {etiqueta}")
            resumen["no_subidas"].append((etiqueta, f"error: {e}"))
            continue
        if all(nm in guardadas for nm in nombres):
            print(f"[{n}/{len(por_corregir)}] ✓ {etiqueta}")
            resumen["subidas"].append((etiqueta, f"etiqueta guardada: {guardadas}"))
        else:
            print(f"[{n}/{len(por_corregir)}] ✗ {etiqueta}")
            resumen["no_subidas"].append((etiqueta, f"el servidor respondió pero guardó '{guardadas}'"))
    return resumen


# ---------------------------------------------------------------- Verificación

def suma_horas(cita):
    """¿Cuenta para las horas mínimas del día? (el almuerzo y lo No productivo no)."""
    if (cita.Subject or "").strip().lower().startswith(tuple(NO_SUMAN_ASUNTOS)):
        return False
    cats = [c.strip().lower() for c in (cita.Categories or "").replace(";", ",").split(",")]
    return not any(c in NO_SUMAN_CATEGORIAS for c in cats)


def horas_por_dia(citas, desde, hasta):
    """Horas que suman por día (sin contar dos veces los cruces). Incluye días laborables sin actividades.
    Devuelve {fecha: (horas, es_laborable)}."""
    intervalos = {}
    for cita in citas:
        if suma_horas(cita):
            ini, fin = hora_local(cita.Start), hora_local(cita.End)
            intervalos.setdefault(ini.date(), []).append((ini, fin))

    resultado = {}
    dia = desde
    while dia <= hasta:
        laborable = dia.weekday() < 5 and dia not in FESTIVOS
        if laborable or dia in intervalos:
            segundos, hasta_aqui = 0, None
            for ini, fin in sorted(intervalos.get(dia, [])):
                if hasta_aqui is None or ini >= hasta_aqui:
                    segundos += (fin - ini).total_seconds()
                    hasta_aqui = fin
                elif fin > hasta_aqui:
                    segundos += (fin - hasta_aqui).total_seconds()
                    hasta_aqui = fin
            resultado[dia] = (segundos / 3600, laborable)
        dia += timedelta(days=1)
    return resultado


def verificar(citas, mi_correo, desde, hasta):
    """Revisa todo antes de subir: estado en Time Capture, duración, cruces y horas por día.
    Devuelve (registradas, pendientes, invalidas, dias_incompletos)."""
    print("\nVerificando actividades antes de subir...")
    cruces = solapes(citas)
    filas = []
    registradas, pendientes, invalidas = [], [], []
    for i, cita in enumerate(citas):
        d = datos_cita(cita, mi_correo)
        notas = []
        try:
            registrada = bool(buscar_existente(d, es_asistente(cita), mi_correo).get("uuid"))
        except Exception as e:
            registrada = False
            notas.append(f"no se pudo consultar: {e}")
        if d["_fin"] <= d["_inicio"]:
            invalidas.append((cita, "la hora de fin no es posterior a la de inicio"))
            notas.append("✗ duración inválida")
        elif registrada:
            registradas.append(cita)
        else:
            pendientes.append(cita)
        if cruces[i]:
            notas.append("⚠ se cruza con: " + "; ".join(cruces[i]))
        if not suma_horas(cita):
            notas.append("no suma horas")
        filas.append((d, registrada, notas))

    horas = horas_por_dia(citas, desde, hasta)
    incompletos = {dia: h for dia, (h, lab) in horas.items() if lab and h < HORAS_MINIMAS_DIA}

    print("=" * 70)
    for dia in sorted(horas):
        h, laborable = horas[dia]
        if not laborable:
            marca = "(no laborable)"
        else:
            marca = "✓" if h >= HORAS_MINIMAS_DIA else f"✗ faltan {HORAS_MINIMAS_DIA - h:.1f} h"
        print(f"\n{dia} ({DIAS_SEMANA[dia.weekday()]})  {h:.1f} h  {marca}")
        del_dia = [f for f in filas if f[0]["_inicio"].date() == dia]
        if not del_dia:
            print("     (sin actividades en Outlook)")
        for d, registrada, notas in del_dia:
            estado = "registrada" if registrada else "pendiente "
            extra = f"   [{' | '.join(notas)}]" if notas else ""
            print(f"   {estado}  {d['_inicio']:%H:%M}-{d['_fin']:%H:%M}  {d['title']}{extra}")

    print("\n" + "=" * 70)
    print(f"Registradas: {len(registradas)}   Pendientes: {len(pendientes)}   Inválidas: {len(invalidas)}")
    if incompletos:
        print(f"Días con menos de {HORAS_MINIMAS_DIA} h: " +
              ", ".join(f"{dia} ({h:.1f} h)" for dia, h in sorted(incompletos.items())))
    else:
        print(f"Todos los días laborables cumplen las {HORAS_MINIMAS_DIA} h.")
    return registradas, pendientes, invalidas, incompletos


def imprimir_resultado(resumen, simular):
    print("\n" + "=" * 70)
    print("RESULTADO" + (" (SIMULACIÓN: no se envió nada)" if simular else ""))
    print("=" * 70)
    titulos = [
        ("subidas", "✓ Se subieron" if not simular else "✓ Se subirían"),
        ("no_subidas", "✗ NO se pudieron subir"),
        ("omitidas", "– No se subieron (omitidas)"),
    ]
    for clave, titulo in titulos:
        lista = resumen[clave]
        print(f"\n{titulo}: {len(lista)}")
        for etiqueta, detalle in lista:
            print(f"   {etiqueta}  — {detalle}")


# ------------------------------------------------------------------------ Main

def fecha(texto):
    return date.today() if texto.lower() == "hoy" else date.fromisoformat(texto)


def preguntar_fecha(mensaje, por_defecto):
    while True:
        r = input(f"{mensaje} [{por_defecto}]: ").strip().lstrip("﻿")
        if not r:
            return por_defecto
        try:
            return fecha(r)
        except ValueError:
            print("Formato no válido. Usa AAAA-MM-DD o 'hoy'.")


def preguntar_rango(args):
    """Modo interactivo (por ejemplo, al ejecutar con el botón de VS Code sin argumentos)."""
    hoy = date.today()
    lunes = hoy - timedelta(days=hoy.weekday())
    args.desde = preguntar_fecha("Desde (AAAA-MM-DD)", lunes)
    args.hasta = preguntar_fecha("Hasta (AAAA-MM-DD)", hoy)
    if not (args.todo or args.reparar_etiquetas):
        r = input("¿Qué quieres hacer? [1] revisar actividad por actividad  [2] subir todo de una  "
                  "[3] corregir etiquetas de lo ya subido [1]: ").strip().lstrip("﻿")
        args.todo = r == "2"
        args.reparar_etiquetas = r == "3"
    if not args.simular:
        r = input("¿Solo simular, sin guardar nada? [s/N]: ").strip().lower()
        args.simular = r in ("s", "si", "sí")


def si(respuesta):
    return respuesta.strip().lower() in ("s", "si", "sí")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Registrar actividades de Outlook en Time Capture")
    p.add_argument("--desde", type=fecha, help="YYYY-MM-DD o 'hoy'")
    p.add_argument("--hasta", type=fecha, help="YYYY-MM-DD o 'hoy' (por defecto: hoy)")
    p.add_argument("--dia", type=fecha, help="Atajo para un solo día")
    p.add_argument("--simular", action="store_true", help="Recorre todo pero no guarda nada en Time Capture")
    p.add_argument("--cita", action="store_true", help="Solo la cita abierta o seleccionada en Outlook")
    p.add_argument("--todo", action="store_true", help="Subir todo de una con la misma clasificación (una sola confirmación)")
    p.add_argument("--reparar-etiquetas", action="store_true",
                   help="Agrega las etiquetas de Outlook a lo ya subido, conservando su clasificación")
    args = p.parse_args()
    if not (args.desde or args.dia or args.cita):
        preguntar_rango(args)

    if args.dia:
        args.desde = args.hasta = args.dia
    desde, hasta = args.desde, args.hasta or date.today()

    # Toda la lectura de Outlook ocurre aquí, de una vez, con un reintento si se pierde la conexión
    print("Leyendo Outlook...")
    for intento in (1, 2):
        try:
            outlook = win32com.client.Dispatch("Outlook.Application")
            namespace = outlook.GetNamespace("MAPI")
            mi_correo = smtp_de(namespace.CurrentUser.AddressEntry).lower()
            leer_colores_categorias(namespace)
            if args.cita:
                cita = cita_actual(outlook)
                citas = [cita] if cita else []
            else:
                citas = citas_en_rango(namespace, desde, hasta)
            break
        except pywintypes.com_error as e:
            if intento == 1:
                print(f"Se perdió la conexión con Outlook ({e.strerror}). Reintentando...")
                time.sleep(5)
            else:
                print("\nNo se pudo leer Outlook. Asegúrate de que Outlook clásico esté abierto,")
                print("que no lo cierres mientras el script lee el calendario, y vuelve a ejecutarlo.")
                sys.exit(1)

    cat = Catalogos()

    if args.cita:
        if not citas:
            print("Abre o selecciona una cita en Outlook.")
            sys.exit(1)
        imprimir_resultado(procesar(citas, mi_correo, cat, DEFAULTS, args.simular), args.simular)
        return

    print(f"{len(citas)} actividad(es) entre {desde} y {hasta} para {mi_correo}.")

    if args.reparar_etiquetas:
        imprimir_resultado(reparar_etiquetas(citas, mi_correo, cat, args.simular), args.simular)
        return

    # 1. Verificación previa
    registradas, pendientes, invalidas, incompletos = verificar(citas, mi_correo, desde, hasta)
    resumen_previo = nuevo_resumen()
    for cita, motivo in invalidas:
        resumen_previo["no_subidas"].append((etiqueta_de(datos_cita(cita, mi_correo)), motivo))

    # 2. Horas mínimas por día
    if incompletos:
        print(f"\n⚠ Hay días laborables con menos de {HORAS_MINIMAS_DIA} h (sin contar almuerzo).")
        op = input("[c] cancelar para completarlos en Outlook  [d] subir solo los días completos  "
                   "[t] subir todo igual  [c]: ").strip().lstrip("﻿").lower()
        if op == "d":
            for lista in (registradas, pendientes):
                quedan = []
                for cita in lista:
                    dia = hora_local(cita.Start).date()
                    if dia in incompletos:
                        resumen_previo["omitidas"].append((etiqueta_de(datos_cita(cita, mi_correo)),
                                                           f"el día solo tiene {incompletos[dia]:.1f} h"))
                    else:
                        quedan.append(cita)
                lista[:] = quedan
        elif op != "t":
            print("Cancelado. Completa las horas en Outlook y vuelve a ejecutar el script.")
            return

    # 3. Qué se procesa
    if args.todo:
        a_procesar = pendientes  # en modo "todo" nunca se tocan las registradas
        for cita in registradas:
            resumen_previo["omitidas"].append((etiqueta_de(datos_cita(cita, mi_correo)), "ya estaba registrada"))
    elif registradas and si(input("\n¿Incluir también las ya registradas para revisarlas/actualizarlas? [s/N]: ")):
        a_procesar = sorted(registradas + pendientes, key=lambda c: hora_local(c.Start))
    else:
        a_procesar = pendientes
        for cita in registradas:
            resumen_previo["omitidas"].append((etiqueta_de(datos_cita(cita, mi_correo)), "ya estaba registrada"))

    if a_procesar:
        modo = procesar_todo if args.todo else procesar
        resumen = modo(a_procesar, mi_correo, cat, DEFAULTS, args.simular)
    else:
        print("\nNo hay actividades pendientes por subir.")
        resumen = nuevo_resumen()

    for clave in resumen:
        resumen[clave] = resumen_previo[clave] + resumen[clave]
    imprimir_resultado(resumen, args.simular)


if __name__ == "__main__":
    main()
