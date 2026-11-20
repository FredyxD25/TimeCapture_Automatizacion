"""
Planificador semanal para Outlook.

Lee tu calendario, respeta las reuniones aceptadas, ubica el almuerzo (1 h entre 12:00 y 14:00)
y llena los huecos del horario laboral con las tareas de tu catálogo. Desde la interfaz puedes
editar todo y, al confirmar, reemplaza las citas genéricas ("Actividad N") en Outlook.

Horario: lunes a jueves 08:00-17:30, viernes 08:00-17:00.

Uso:
    pip install flask pywin32
    python servidor.py           # abre http://127.0.0.1:5173 ... o la interfaz compilada en :5000
"""

import json
import os
import re
import sys
import threading
import webbrowser
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pythoncom
import pywintypes
import win32com.client
from flask import Flask, jsonify, request, send_from_directory

import etiquetas

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent))  # festivos.py y time_capture.py están en la carpeta del proyecto
CATALOGO = BASE / "catalogo.json"
RESPALDOS = BASE / "respaldos"
DIST = BASE / "web" / "dist"

HORARIO = {  # weekday -> (inicio, fin)
    0: (time(8, 0), time(17, 30)),
    1: (time(8, 0), time(17, 30)),
    2: (time(8, 0), time(17, 30)),
    3: (time(8, 0), time(17, 30)),
    4: (time(8, 0), time(17, 0)),
}
ALMUERZO_VENTANA = (time(12, 0), time(14, 0))
ALMUERZO_MIN = 60
ALMUERZO_TITULO = "Almuerzo"
ALMUERZO_CATEGORIA = "No productivo"
BLOQUE_MIN = 30   # no se crean bloques más cortos que esto
# Cierre de mes: en los primeros días hábiles, los informes semanales se hacen como cierre
DIAS_HABILES_CIERRE = 5
CIERRE_PREFIJO = "CIERRE - "
CIERRE_CATEGORIA = "Cierre del mes"
PASO_MIN = 15     # redondeo de horas

# Citas que el planificador puede reemplazar
GENERICA = re.compile(r"^\s*actividad\s*\d+", re.IGNORECASE)

# Festivos de Colombia, calculados para cualquier año (../festivos.py)
from festivos import FESTIVOS, festivos_de  # noqa: E402

# Constantes de Outlook
OL_FOLDER_CALENDAR = 9
OL_APPOINTMENT_ITEM = 1
OL_BUSY = 2
OL_NON_MEETING, OL_MEETING, OL_MEETING_RECEIVED = 0, 1, 3
OL_MEETING_CANCELED, OL_MEETING_RECEIVED_CANCELED = 5, 7
OL_RESPONSE_ORGANIZED, OL_RESPONSE_TENTATIVE, OL_RESPONSE_ACCEPTED = 1, 2, 3
OL_RESPONSE_DECLINED, OL_RESPONSE_NOT_RESPONDED = 4, 5


# ----------------------------------------------------------------------- Outlook

def outlook():
    pythoncom.CoInitialize()
    app = win32com.client.Dispatch("Outlook.Application")
    return app, app.GetNamespace("MAPI")


def local(valor):
    # pywin32 marca las fechas de Outlook como UTC aunque son hora local
    return valor.replace(tzinfo=None)


def a_outlook(dt):
    # Inverso de local(): Outlook interpreta el valor como hora local
    return pywintypes.Time(dt.replace(tzinfo=timezone.utc))


def categorias_outlook(ns):
    res = []
    for c in ns.Categories:
        res.append({"nombre": c.Name, "color": c.Color})
    return sorted(res, key=lambda c: c["nombre"].lower())


def id_de(cita):
    return f"{cita.EntryID}|{local(cita.Start).isoformat()}"


def item_por_id(ns, ident):
    entry_id, inicio = ident.split("|", 1)
    item = ns.GetItemFromID(entry_id)
    if item.IsRecurring:
        item = item.GetRecurrencePattern().GetOccurrence(a_outlook(datetime.fromisoformat(inicio)))
    return item


def poner_categoria(ns, ident, categoria):
    """Cambia la categoría de una cita. En Outlook las categorías de una cita recurrente son de
    toda la serie (una repetición sola no admite el cambio), así que en ese caso se aplica a la serie.
    Devuelve True si se aplicó a la serie completa."""
    # El EntryID de una repetición es el de su serie: abrirlo devuelve la serie (o la cita, si no se repite)
    item = ns.GetItemFromID(ident.split("|", 1)[0])
    item.Categories = categoria
    item.Save()
    return bool(item.IsRecurring)


def tipo_de(cita):
    asunto = (cita.Subject or "").strip()
    if cita.MeetingStatus in (OL_MEETING_CANCELED, OL_MEETING_RECEIVED_CANCELED) \
            or asunto.lower().startswith(("cancelado:", "canceled:")):
        return None
    if cita.MeetingStatus == OL_MEETING_RECEIVED:
        r = cita.ResponseStatus
        if r == OL_RESPONSE_ACCEPTED:
            return "reunion"
        if r == OL_RESPONSE_DECLINED:
            return None
        return "reunion_pendiente"  # provisional o sin responder: se muestra, no bloquea
    if cita.MeetingStatus == OL_MEETING:
        return "reunion"  # la organizas tú
    if GENERICA.match(asunto):
        return "generica"
    if asunto.lower().startswith(ALMUERZO_TITULO.lower()):
        return "almuerzo"
    return "propia"


def leer_rango(ns, desde, hasta):
    items = ns.GetDefaultFolder(OL_FOLDER_CALENDAR).Items
    items.IncludeRecurrences = True
    items.Sort("[Start]")
    ini = datetime.combine(desde, time.min).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), time.min).astimezone(timezone.utc)
    filtro = ('@SQL="urn:schemas:calendar:dtstart" >= \'{0}\' AND '
              '"urn:schemas:calendar:dtstart" < \'{1}\'').format(
        ini.strftime("%Y-%m-%d %H:%M"), fin.strftime("%Y-%m-%d %H:%M"))
    citas = []
    for c in items.Restrict(filtro):
        inicio = local(c.Start)
        if not (desde <= inicio.date() <= hasta) or c.AllDayEvent:
            continue
        tipo = tipo_de(c)
        if tipo is None:
            continue
        citas.append({
            "id": id_de(c),
            "titulo": c.Subject or "",
            "inicio": inicio.isoformat(timespec="minutes"),
            "fin": local(c.End).isoformat(timespec="minutes"),
            "categoria": (c.Categories or "").split(",")[0].split(";")[0].strip(),
            "tipo": tipo,
            "organizador": c.Organizer or "",
        })
    return citas


# --------------------------------------------------------------------- Planificador

def redondear(dt):
    minutos = (dt.hour * 60 + dt.minute + PASO_MIN - 1) // PASO_MIN * PASO_MIN
    return datetime.combine(dt.date(), time()) + timedelta(minutes=minutos)


def restar(intervalos, ocupados):
    """Intervalos libres = intervalos - ocupados (listas de (ini, fin))."""
    libres = []
    for a, b in intervalos:
        cursor = a
        for o_ini, o_fin in sorted(ocupados):
            if o_fin <= cursor or o_ini >= b:
                continue
            if o_ini > cursor:
                libres.append((cursor, o_ini))
            cursor = max(cursor, o_fin)
        if cursor < b:
            libres.append((cursor, b))
    return libres


def ubicar_almuerzo(dia, ocupados):
    """Primera hora libre dentro de 12:00-14:00; si no hay, la que menos se cruce."""
    v_ini = datetime.combine(dia, ALMUERZO_VENTANA[0])
    v_fin = datetime.combine(dia, ALMUERZO_VENTANA[1])
    mejor, mejor_cruce = None, None
    t = v_ini
    while t + timedelta(minutes=ALMUERZO_MIN) <= v_fin:
        fin = t + timedelta(minutes=ALMUERZO_MIN)
        cruce = sum(max(0, (min(fin, b) - max(t, a)).total_seconds()) for a, b in ocupados)
        if mejor_cruce is None or cruce < mejor_cruce:
            mejor, mejor_cruce = (t, fin), cruce
        if cruce == 0:
            break
        t += timedelta(minutes=PASO_MIN)
    return mejor, mejor_cruce > 0


def planificar_dia(dia, citas_dia, catalogo, periodicas=None):
    """Devuelve la propuesta de bloques para un día laborable."""
    j_ini = datetime.combine(dia, HORARIO[dia.weekday()][0])
    j_fin = datetime.combine(dia, HORARIO[dia.weekday()][1])

    fijas = [c for c in citas_dia if c["tipo"] in ("reunion", "propia") and c.get("accion") != "borrar"]
    ocupados = [(datetime.fromisoformat(c["inicio"]), datetime.fromisoformat(c["fin"])) for c in fijas]

    (a_ini, a_fin), cruce_almuerzo = ubicar_almuerzo(dia, ocupados)
    bloques = [{
        "titulo": ALMUERZO_TITULO, "categoria": ALMUERZO_CATEGORIA,
        "inicio": a_ini.isoformat(timespec="minutes"), "fin": a_fin.isoformat(timespec="minutes"),
        "almuerzo": True,
    }]
    avisos = ["El almuerzo se cruza con una reunión"] if cruce_almuerzo else []

    # Primero va una vez cada periódica asignada a este día (urgentes primero) y cada semanal del día,
    # en el primer hueco donde quepa completa. Si sobra tiempo, se repiten las semanales para completar
    # la jornada, pero solo si el día tiene al menos dos actividades distintas: con una sola, el resto
    # queda en blanco para completarlo a mano (un día no debe irse en una sola actividad).
    # Lo que ya está en el calendario ese día (con el mismo título) no se vuelve a proponer
    ya_estan = {etiquetas.normalizar(c["titulo"]) for c in fijas}
    nueva = lambda t: etiquetas.normalizar(t["titulo"]) not in ya_estan  # noqa: E731
    # En los primeros días hábiles del mes los informes semanales son el cierre del mes anterior
    semanales_catalogo = [como_cierre(t, dia) for t in catalogo if frecuencia(t) == "semanal"]
    semanales = [t for t in semanales_catalogo if dia.weekday() in (t.get("dias") or []) and nueva(t)]
    periodicas = sorted([t for t in (periodicas or []) if nueva(t)], key=lambda t: not t.get("urgente"))
    cola = periodicas + semanales
    relleno = semanales or [t for t in semanales_catalogo if nueva(t)]
    minimo = timedelta(minutes=BLOQUE_MIN)
    huecos = [[redondear(a), b] for a, b in restar([(j_ini, j_fin)], ocupados + [(a_ini, a_fin)])]
    huecos = [h for h in huecos if h[1] - h[0] >= minimo]

    def agregar(tarea, ini, fin):
        bloques.append({
            "titulo": tarea["titulo"], "categoria": tarea.get("categoria", ""),
            "inicio": ini.isoformat(timespec="minutes"), "fin": fin.isoformat(timespec="minutes"),
            **({"urgente": True} if tarea.get("urgente") else {}),
        })

    # 1) Cada tarea una vez: en el primer hueco donde quepa completa; si no cabe en ninguno, en el más grande
    pendientes_tareas = []
    for tarea in cola:
        dur = timedelta(minutes=int(tarea.get("duracion") or 60))
        libres = [h for h in huecos if h[1] - h[0] >= minimo]
        hueco = next((h for h in libres if h[1] - h[0] >= dur), None) or max(libres, key=lambda h: h[1] - h[0], default=None)
        if hueco is None:
            pendientes_tareas.append(tarea)
            continue
        fin = min(hueco[0] + dur, hueco[1])
        if hueco[1] - fin < minimo:
            fin = hueco[1]  # evita dejar un pedacito suelto al final del hueco
        agregar(tarea, hueco[0], fin)
        hueco[0] = fin

    # 2) Completar la jornada repitiendo las semanales, solo si el día ya tiene dos actividades distintas
    distintas = {b["titulo"] for b in bloques if not b.get("almuerzo")}
    if len(distintas) >= 2 and relleno:
        i = 0
        for hueco in sorted(huecos, key=lambda h: h[0]):
            while hueco[1] - hueco[0] >= minimo:
                tarea = relleno[i % len(relleno)]
                i += 1
                fin = min(hueco[0] + timedelta(minutes=int(tarea.get("duracion") or 60)), hueco[1])
                if hueco[1] - fin < minimo:
                    fin = hueco[1]
                agregar(tarea, hueco[0], fin)
                hueco[0] = fin
    elif any(h[1] - h[0] >= minimo for h in huecos):
        avisos.append("Solo hay una actividad para este día: el resto queda libre para completarlo")

    # Lo que no cupo queda pendiente: la interfaz lo ubica si se libera espacio
    pendientes = [{k: t.get(k) for k in ("id", "titulo", "categoria", "duracion", "urgente")} for t in pendientes_tareas]
    bloques.sort(key=lambda b: b["inicio"])
    # Une bloques seguidos de la misma tarea (p. ej. cuando se repite para completar la jornada)
    unidos = []
    for b in bloques:
        if unidos and unidos[-1]["titulo"] == b["titulo"] and unidos[-1]["fin"] == b["inicio"]:
            unidos[-1]["fin"] = b["fin"]
        else:
            unidos.append(b)
    return unidos, avisos, pendientes


# ------------------------------------------------------------ Frecuencias del catálogo

def frecuencia(tarea):
    return tarea.get("frecuencia") or "semanal"


def es_semana_cierre(d):
    """Primeros días hábiles del mes: los informes semanales se hacen como cierre de mes."""
    return 1 <= (numero_habil(d) or 0) <= DIAS_HABILES_CIERRE


def como_cierre(tarea, d):
    """La tarea semanal tal como se programa ese día: en semana de cierre lleva el prefijo y la etiqueta de cierre."""
    if not es_semana_cierre(d) or tarea["titulo"].upper().startswith(CIERRE_PREFIJO.strip()):
        return tarea
    return {**tarea, "titulo": f"{CIERRE_PREFIJO}{tarea['titulo']}", "categoria": CIERRE_CATEGORIA}


def es_habil(d):
    return d.weekday() < 5 and d not in FESTIVOS


def habil_desde(d):
    """El mismo día si es hábil; si no, el siguiente día hábil."""
    while not es_habil(d):
        d += timedelta(days=1)
    return d


def numero_habil(d):
    """1 = primer día hábil del mes. None si d no es hábil."""
    if not es_habil(d):
        return None
    return sum(1 for k in range(1, d.day + 1) if es_habil(d.replace(day=k)))


def dias_posibles(tarea, desde, hasta):
    """Días hábiles del rango en los que puede ir una tarea quincenal o mensual."""
    f = frecuencia(tarea)
    posibles = []
    d = desde
    while d <= hasta:
        if es_habil(d):
            if f == "quincenal" or (f == "mensual" and tarea.get("dia_mes")):
                objetivos = tarea.get("dias_mes") or [tarea.get("dia_mes")]
                if any(habil_desde(d.replace(day=int(n))) == d for n in objetivos if n):
                    posibles.append(d)
            elif f == "mensual" and tarea.get("habiles"):
                a, b = tarea["habiles"]
                if a <= (numero_habil(d) or 0) <= b:
                    posibles.append(d)
        d += timedelta(days=1)
    return posibles


def repartir_periodicas(catalogo, desde, hasta, ya_programadas=None):
    """ya_programadas: {título normalizado: [fechas]} de lo que ya está en Outlook en los meses del rango;
    una tarea mensual/quincenal que ya existe en su mes (o quincena) no se vuelve a proponer."""
    ya_programadas = ya_programadas or {}
    """Asigna cada tarea quincenal/mensual a un día de su ventana, repartiendo la carga."""
    asignadas = {}
    carga = {}
    for t in sorted(catalogo, key=lambda t: not t.get("urgente")):
        if frecuencia(t) not in ("quincenal", "mensual"):
            continue
        # Una vez por ventana: agrupa los días posibles por (mes, quincena)
        grupos = {}
        for d in dias_posibles(t, desde, hasta):
            clave = (d.year, d.month, 0 if frecuencia(t) == "mensual" else (1 if d.day >= 16 else 0))
            grupos.setdefault(clave, []).append(d)
        existentes = ya_programadas.get(etiquetas.normalizar(t["titulo"]), [])
        for (anio, mes, quincena), dias in grupos.items():
            if any(f.year == anio and f.month == mes and (frecuencia(t) == "mensual" or (1 if f.day >= 16 else 0) == quincena)
                   for f in existentes):
                continue  # ya está programada en esa ventana
            elegido = min(dias, key=lambda d: (carga.get(d, 0), d))
            asignadas.setdefault(elegido, []).append(t)
            carga[elegido] = carga.get(elegido, 0) + int(t.get("duracion") or 60)
    return asignadas


def minutos_productivos(dia_info):
    """Unión de reuniones aceptadas, propias y bloques (sin almuerzo) dentro del horario."""
    dia = date.fromisoformat(dia_info["fecha"])
    j_ini = datetime.combine(dia, HORARIO[dia.weekday()][0])
    j_fin = datetime.combine(dia, HORARIO[dia.weekday()][1])
    tramos = []
    for c in dia_info["citas"]:
        if c["tipo"] in ("reunion", "propia") and c.get("accion") != "borrar":
            tramos.append((c["inicio"], c["fin"]))
    for b in dia_info["bloques"]:
        if not b.get("almuerzo"):
            tramos.append((b["inicio"], b["fin"]))
    total, hasta = 0, None
    for ini, fin in sorted((max(datetime.fromisoformat(a), j_ini), min(datetime.fromisoformat(b), j_fin))
                           for a, b in tramos):
        if fin <= ini:
            continue
        if hasta is None or ini >= hasta:
            total += (fin - ini).total_seconds()
            hasta = fin
        elif fin > hasta:
            total += (fin - hasta).total_seconds()
            hasta = fin
    return total / 60


# ---------------------------------------------------------------------------- API

app = Flask(__name__, static_folder=None)
bloqueo = threading.Lock()  # Outlook COM: una operación a la vez


@app.after_request
def sin_cache(respuesta):
    # La ventana de escritorio (WebView2) no debe reutilizar respuestas viejas de la API
    if request.path.startswith("/api/"):
        respuesta.headers["Cache-Control"] = "no-store"
    return respuesta


def leer_catalogo():
    try:
        return json.loads(CATALOGO.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


@app.get("/api/catalogo")
def get_catalogo():
    return jsonify(leer_catalogo())


@app.put("/api/catalogo")
def put_catalogo():
    datos = request.get_json()
    CATALOGO.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True})


@app.get("/api/festivos")
def get_festivos():
    """Festivos de Colombia de los años pedidos (para marcarlos en el selector de fechas)."""
    hoy = date.today().year
    desde = int(request.args.get("desde", hoy - 1))
    hasta = int(request.args.get("hasta", hoy + 1))
    return jsonify([{"fecha": d.isoformat(), "nombre": n}
                    for anio in range(desde, hasta + 1) for d, n in festivos_de(anio).items()])


@app.get("/api/reglas-etiquetas")
def get_reglas():
    return jsonify(etiquetas.leer_reglas())


@app.put("/api/reglas-etiquetas")
def put_reglas():
    etiquetas.guardar_reglas(request.get_json())
    return jsonify({"ok": True})


@app.get("/api/categorias")
def get_categorias():
    with bloqueo:
        _, ns = outlook()
        return jsonify(categorias_outlook(ns))


@app.get("/api/semana")
def get_semana():
    """Calendario actual + propuesta de bloques para cada día laborable del rango."""
    desde = date.fromisoformat(request.args["desde"])
    hasta = date.fromisoformat(request.args["hasta"])
    with bloqueo:
        _, ns = outlook()
        citas = leer_rango(ns, desde, hasta)
        etiquetas.cargar_historial(ns)
        # Meses completos que toca el rango: para no repetir mensuales/quincenales ya programadas
        inicio_mes = desde.replace(day=1)
        fin_mes = (hasta.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        del_mes = leer_rango(ns, inicio_mes, fin_mes)
    ya_programadas = {}
    for c in del_mes:
        if c["tipo"] in ("propia", "reunion"):
            ya_programadas.setdefault(etiquetas.normalizar(c["titulo"]), []).append(date.fromisoformat(c["inicio"][:10]))
    catalogo = leer_catalogo()
    # Reuniones y citas propias sin categoría: se les preestablece la sugerida (se guarda al aplicar)
    for c in citas:
        if c["tipo"] in ("reunion", "propia") and not c["categoria"]:
            s = etiquetas.sugerir(c["titulo"], catalogo)
            if s:
                c["categoria_nueva"] = s["categoria"]
                c["sugerida"] = s
    dias = []
    periodicas = repartir_periodicas(catalogo, desde, hasta, ya_programadas)
    semanales_normales = {etiquetas.normalizar(t["titulo"]) for t in catalogo if frecuencia(t) == "semanal"}
    d = desde
    while d <= hasta:
        if d.weekday() in HORARIO:
            del_dia = [c for c in citas if c["inicio"].startswith(d.isoformat())]
            festivo = d in FESTIVOS
            cierre = es_semana_cierre(d)
            for c in del_dia:
                # En festivos no se borra nada
                c["accion"] = "borrar" if c["tipo"] in ("generica", "almuerzo") and not festivo else "mantener"
                # En la semana de cierre, un informe semanal con su nombre normal se reemplaza por su versión CIERRE
                if cierre and c["tipo"] == "propia" and etiquetas.normalizar(c["titulo"]) in semanales_normales:
                    c["accion"] = "borrar"
                    c["reemplazo_cierre"] = True
            del_dia_periodicas = periodicas.get(d, [])
            bloques, avisos, pendientes = ([], ["Festivo"], []) if festivo else \
                planificar_dia(d, del_dia, catalogo, del_dia_periodicas)
            ini, fin = HORARIO[d.weekday()]
            info = {
                "fecha": d.isoformat(), "festivo": festivo,
                "jornada": [ini.strftime("%H:%M"), fin.strftime("%H:%M")],
                "citas": del_dia, "bloques": bloques, "avisos": avisos, "pendientes": pendientes,
                "periodicas": [t["id"] for t in del_dia_periodicas],
            }
            info["minutos"] = minutos_productivos(info)
            dias.append(info)
        d += timedelta(days=1)
    return jsonify(dias)


@app.post("/api/replanificar")
def replanificar():
    """Vuelve a proponer bloques para un día con las citas que llegan (respeta lo que el usuario marcó)."""
    dia_info = request.get_json()
    d = date.fromisoformat(dia_info["fecha"])
    citas = [c for c in dia_info["citas"] if c.get("accion") != "borrar"]
    catalogo = leer_catalogo()
    ids = set(dia_info.get("periodicas") or [])
    bloques, avisos, pendientes = planificar_dia(d, citas, catalogo, [t for t in catalogo if t.get("id") in ids])
    return jsonify({"bloques": bloques, "avisos": avisos, "pendientes": pendientes})


@app.post("/api/minutos")
def minutos():
    return jsonify({"minutos": minutos_productivos(request.get_json())})


@app.post("/api/aplicar")
def aplicar():
    """Escribe en Outlook: borra lo marcado, crea los bloques y categoriza reuniones.
    Antes guarda un respaldo de lo que va a borrar."""
    dias = request.get_json()
    RESPALDOS.mkdir(exist_ok=True)
    resultado = {"creados": 0, "borrados": 0, "categorizados": 0, "errores": []}
    respaldo = []
    series_categorizadas = set()
    with bloqueo:
        app_ol, ns = outlook()
        for dia in dias:
            for c in dia["citas"]:
                try:
                    if c.get("accion") == "borrar":
                        item = item_por_id(ns, c["id"])
                        respaldo.append({k: c[k] for k in ("titulo", "inicio", "fin", "categoria", "tipo")})
                        item.Delete()
                        resultado["borrados"] += 1
                    elif c.get("categoria_nueva") is not None and c["categoria_nueva"] != c.get("categoria"):
                        serie = c["id"].split("|", 1)[0]
                        if serie in series_categorizadas:
                            continue  # otra repetición de la misma serie ya se categorizó
                        if poner_categoria(ns, c["id"], c["categoria_nueva"]):
                            series_categorizadas.add(serie)
                        resultado["categorizados"] += 1
                except pywintypes.com_error as e:
                    resultado["errores"].append(f"{c['titulo']} ({c['inicio']}): {e.strerror}")
            for b in dia["bloques"]:
                try:
                    cita = app_ol.CreateItem(OL_APPOINTMENT_ITEM)
                    cita.Subject = b["titulo"]
                    cita.Start = a_outlook(datetime.fromisoformat(b["inicio"]))
                    cita.End = a_outlook(datetime.fromisoformat(b["fin"]))
                    cita.Categories = b.get("categoria") or ""
                    cita.BusyStatus = OL_BUSY
                    cita.ReminderSet = False
                    cita.Save()
                    resultado["creados"] += 1
                except pywintypes.com_error as e:
                    resultado["errores"].append(f"{b['titulo']} ({b['inicio']}): {e.strerror}")
    if respaldo:
        archivo = RESPALDOS / f"borrados_{datetime.now():%Y%m%d_%H%M%S}.json"
        archivo.write_text(json.dumps(respaldo, ensure_ascii=False, indent=2), encoding="utf-8")
        resultado["respaldo"] = str(archivo)
    # Aprendizaje de etiquetas: bloques creados con categoría y reuniones/citas a las que se les cambió
    etiquetas.aprender_varias(
        [(b["titulo"], b.get("categoria")) for dia in dias for b in dia["bloques"] if not b.get("almuerzo")]
        + [(c["titulo"], c.get("categoria_nueva")) for dia in dias for c in dia["citas"]
           if c.get("accion") != "borrar" and c.get("categoria_nueva")]
    )
    return jsonify(resultado)


@app.get("/api/etiquetas-aprendidas")
def get_aprendidas():
    datos = etiquetas.leer_aprendidas()
    lista = [{"clave": k, **v} for k, v in datos.items()]
    return jsonify(sorted(lista, key=lambda a: a.get("ultima", ""), reverse=True))


@app.post("/api/etiquetas-aprendidas")
def post_aprendida():
    """{titulo, categoria}: enseña o corrige una etiqueta a mano."""
    d = request.get_json()
    etiquetas.aprender(d["titulo"], d["categoria"])
    return jsonify({"ok": True})


@app.post("/api/etiquetas-aprendidas/olvidar")
def olvidar_aprendida():
    etiquetas.olvidar(request.get_json()["clave"])
    return jsonify({"ok": True})


import tc_api  # noqa: E402  (pestaña Time Capture)
tc_api.init(app, outlook, bloqueo, item_por_id, poner_categoria, leer_catalogo)


# Interfaz compilada (npm run build)
@app.get("/")
@app.get("/<path:ruta>")
def web(ruta="index.html"):
    if not DIST.exists():
        return "Compila la interfaz: cd web && npm install && npm run build", 404
    destino = DIST / ruta
    return send_from_directory(DIST, ruta if destino.is_file() else "index.html")


if __name__ == "__main__":
    if not os.environ.get("PLANIFICADOR_SIN_NAVEGADOR"):
        threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:5000")).start()
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
